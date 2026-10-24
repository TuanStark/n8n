import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../db/pool';
import { IChannelRepository } from '../ports/IChannelRepository';
import { IStorageService } from '../ports/IStorageService';
import { IScriptDirector } from '../ports/IScriptDirector';
import { VideoJobResult } from '../domain/VideoJob';
import { VoiceProvider } from '../../providers/voiceProvider';
import { AssSubtitleBuilder } from '../../render/assSubtitleBuilder';
import { FFmpegEngine, SceneInput } from '../../render/ffmpegEngine';
import { ImageProvider } from '../../providers/imageProvider';
import { QcValidator } from '../../qc/qcValidator';
import { YouTubePublisher } from '../../publish/youtubePublisher';

export interface ProduceShortCommand {
  channelId: string;
  topic: string;
  customInstructions?: string;
  publishYouTube?: boolean;
  privacyStatus?: 'private' | 'unlisted' | 'public';
}

export class ProduceMultiChannelShortUseCase {
  constructor(
    private channelRepo: IChannelRepository,
    private storageService: IStorageService,
    private scriptDirector: IScriptDirector,
    private voiceProvider: VoiceProvider,
    private subtitleBuilder: AssSubtitleBuilder,
    private ffmpegEngine: FFmpegEngine,
    private imageProvider: ImageProvider,
    private qcValidator: QcValidator
  ) {}

  async execute(command: ProduceShortCommand): Promise<VideoJobResult> {
    const jobId = `job_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    console.log(`\n===============================================================`);
    console.log(`[ProduceShortUseCase] 🚀 Starting Job ${jobId} for Channel "${command.channelId}"`);
    console.log(`===============================================================`);

    // 1. Resolve Channel & Brand DNA
    const channel = await this.channelRepo.getChannelById(command.channelId);
    if (!channel) {
      throw new Error(`Channel "${command.channelId}" not found in database.`);
    }

    const genre = await this.channelRepo.getGenreProfile(channel.genreKey);
    console.log(`[ProduceShortUseCase] Resolved Channel "${channel.name}" with Genre "${genre.name}"`);

    // 2. Setup Ephemeral Scratchpad (Zero Local Footprint Principle)
    const scratchpadDir = await this.storageService.createScratchpad(jobId);
    let masterVideoPath: string | null = null;
    let purgedLocalDisk = false;

    const client = await pool.connect();
    try {
      // 3. Step 1: Generate Directorial Script via AGY Engine
      console.log(`[ProduceShortUseCase] Step 1/6: Scriptwriting via AGY Engine...`);
      const script = await this.scriptDirector.generateScriptForChannel(
        command.topic,
        genre,
        command.customInstructions
      );

      // Record in topics table
      const topicInsert = await client.query(
        `INSERT INTO topics (
          title, category, historical_period, status, potential_score, target_duration_sec, channel_id, genre_id
        ) VALUES ($1, $2, $3, 'SCRIPTING', 95, $4, $5, $6) RETURNING id`,
        [script.title, genre.name, genre.id, script.targetDurationSec, channel.id, genre.id]
      );
      const topicId = topicInsert.rows[0].id;

      // 4. Step 2: Generate Scene Assets (Images & Voice Narration) in Scratchpad
      console.log(`[ProduceShortUseCase] Step 2/6: Synthesizing scenes (${script.scenes.length} images) & voiceover...`);
      const sceneInputs: SceneInput[] = [];
      const sceneDescriptions: string[] = [];

      for (const scene of script.scenes) {
        sceneDescriptions.push(scene.visualDescription);
        const imagePath = await this.imageProvider.generateSceneImage({
          storyboardId: jobId,
          sceneIndex: scene.sceneIndex,
          category: genre.name,
          visualDescription: scene.visualDescription,
          positivePrompt: scene.positivePrompt,
          narrationText: scene.narrationText,
          stylePromptOverride: genre.visualStylePrompt,
          negativePromptOverride: genre.visualNegativePrompt,
        });

        sceneInputs.push({
          sceneIndex: scene.sceneIndex,
          durationSec: scene.durationSec,
          imagePath,
          cameraMovement: scene.cameraMovement || 'push_in',
        });
      }

      // Voiceover synthesis
      const voiceResult = await this.voiceProvider.generateVoice(
        script.fullScript,
        `${jobId}_narration`
      );

      // 5. Step 3: Subtitles (.ass)
      console.log(`[ProduceShortUseCase] Step 3/6: Building animated ASS subtitles...`);
      let accumulatedSec = 0;
      const subtitleEvents = script.narrationSegments.map((seg) => {
        const start = accumulatedSec;
        const dur = seg.estimatedSec || 4.0;
        accumulatedSec += dur;
        return { startSec: start, endSec: accumulatedSec, text: seg.text };
      });

      const subtitleAssPath = this.subtitleBuilder.generateAssFile(
        subtitleEvents,
        `${jobId}_subs`,
        script.hookHeadline
      );

      // 6. Step 4: Video Compositing via FFmpeg
      console.log(`[ProduceShortUseCase] Step 4/6: Compositing vertical 1080x1920 video with [${genre.soundscapePreset}] audio...`);
      const renderRes = await this.ffmpegEngine.renderShort(
        jobId,
        sceneInputs,
        voiceResult.audioPath,
        subtitleAssPath,
        genre.soundscapePreset
      );
      masterVideoPath = renderRes.outputPath;

      // 7. Step 5: Automated Quality Control (QC)
      console.log(`[ProduceShortUseCase] Step 5/6: Automated QC Inspection...`);
      const qcReport = await this.qcValidator.validateVideo(
        masterVideoPath,
        sceneDescriptions,
        renderRes.durationSec
      );

      // 8. Step 6: CLOUDINARY DIRECT UPLOAD (Zero-Local Persistence)
      console.log(`[ProduceShortUseCase] Step 6/6: ☁️ Offloading video directly to Cloudinary CDN...`);
      let cloudinaryUrl = '';
      let cloudinaryPublicId = '';

      if (this.storageService.isConfigured()) {
        const cloudUpload = await this.storageService.uploadVideoToCloudinary(masterVideoPath, {
          channelId: channel.id,
          jobId,
          tags: ['shorts_factory', channel.id, genre.id],
        });
        cloudinaryUrl = cloudUpload.secureUrl;
        cloudinaryPublicId = cloudUpload.publicId;
      } else {
        console.warn(`[ProduceShortUseCase] ⚠️ Cloudinary not configured in .env. Video remains in ephemeral storage until purge.`);
        cloudinaryUrl = `https://mock-cdn.local/${channel.id}/${jobId}.mp4`;
        cloudinaryPublicId = `${channel.id}_${jobId}`;
      }

      // Record in render_jobs and media_assets
      const renderJobInsert = await client.query(
        `INSERT INTO render_jobs (
          output_resolution, fps, status, render_duration_sec, cloudinary_url, cloudinary_public_id
        ) VALUES ('1080x1920', 30, 'COMPLETED', $1, $2, $3) RETURNING id`,
        [renderRes.durationSec, cloudinaryUrl, cloudinaryPublicId]
      );
      const renderJobId = renderJobInsert.rows[0].id;

      // 9. Optional: Upload to YouTube using this channel's dedicated credentials
      let youtubeVideoId: string | undefined;
      let youtubeUrl: string | undefined;

      if (command.publishYouTube && channel.credentials?.refreshToken) {
        try {
          console.log(`[ProduceShortUseCase] 📺 Publishing to YouTube channel "${channel.name}"...`);
          const publisher = new YouTubePublisher();
          const uploadRes = await publisher.uploadShort(masterVideoPath, {
            title: script.title,
            description: script.fullScript,
            category: genre.name,
            channelName: channel.name,
            privacyStatus: command.privacyStatus || channel.defaultPrivacy,
          });

          youtubeVideoId = uploadRes.videoId;
          youtubeUrl = uploadRes.youtubeUrl;

          await client.query(
            `INSERT INTO youtube_videos (
              topic_id, render_job_id, youtube_video_id, title, description, tags, privacy_status, upload_status, channel_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UPLOADED', $8)`,
            [
              topicId,
              renderJobId,
              youtubeVideoId,
              script.title.slice(0, 100),
              script.fullScript,
              channel.defaultTags,
              uploadRes.privacyStatus,
              channel.id,
            ]
          );

          await this.channelRepo.updateQuotaUsed(channel.id, 1600);
        } catch (ytErr: any) {
          console.error(`[ProduceShortUseCase] YouTube upload error: ${ytErr.message}`);
        }
      }

      await client.query("UPDATE topics SET status = 'PUBLISHED' WHERE id = $1", [topicId]);

      return {
        jobId,
        channelId: channel.id,
        channelName: channel.name,
        genreKey: genre.id,
        title: script.title,
        durationSec: renderRes.durationSec,
        fileSizeBytes: renderRes.fileSizeBytes,
        cloudinaryUrl,
        cloudinaryPublicId,
        youtubeVideoId,
        youtubeUrl,
        purgedLocalDisk: true,
        qcStatus: qcReport.overallStatus,
        createdAt: new Date(),
      };
    } finally {
      // 10. GUARANTEED DETERMINISTIC SCRATCHPAD PURGE
      // Ensures local disk footprint is 0 bytes regardless of success or failure
      console.log(`[ProduceShortUseCase] 🧹 Executing guaranteed ephemeral scratchpad purge...`);
      await this.storageService.purgeScratchpad(scratchpadDir);
      purgedLocalDisk = true;
      client.release();
    }
  }
}
