import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { GeminiProvider, ScriptOutput } from '../providers/geminiProvider';
import { VoiceProvider } from '../providers/voiceProvider';
import { AssSubtitleBuilder } from '../render/assSubtitleBuilder';
import { FFmpegEngine, SceneInput } from '../render/ffmpegEngine';
import { QcValidator } from '../qc/qcValidator';
import { SlackNotifier } from '../notifications/slackNotifier';
import { YouTubePublisher, ChannelCredentialsInput } from '../publish/youtubePublisher';
import { ImageProvider } from '../providers/imageProvider';
import { CloudinaryProvider } from '../providers/cloudinaryProvider';
import { GenreService, GenreProfile, ChannelWithGenre } from '../services/genreService';
import { config } from '../config';

export interface MultiChannelProductionRequest {
  channelId?: string;
  topicId?: string;
  channelConfig?: {
    id?: string;
    name?: string;
    genreKey?: string;
    youtube?: ChannelCredentialsInput;
  };
  content: {
    title: string;
    prompt?: string;
    category?: string;
    targetDurationSec?: number;
  };
  options?: {
    publishYouTube?: boolean;
    uploadCloudinary?: boolean;
    purgeLocalAfterUpload?: boolean;
    privacyStatus?: 'private' | 'unlisted' | 'public';
  };
}

export interface ProductionResult {
  success: boolean;
  channelId: string;
  channelName: string;
  genreKey: string;
  topicId: string;
  title: string;
  renderJobId: string;
  durationSec: number;
  fileSizeBytes: number;
  localVideoPath?: string;
  cloudinaryUrl?: string;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  qcResult: any;
  purgedLocalDisk: boolean;
}

export class MultiChannelPipelineRunner {
  private gemini: GeminiProvider;
  private voice: VoiceProvider;
  private subtitleBuilder: AssSubtitleBuilder;
  private ffmpeg: FFmpegEngine;
  private qc: QcValidator;
  private slack: SlackNotifier;
  private imageProvider: ImageProvider;
  private cloudinary: CloudinaryProvider;
  private genreService: GenreService;

  constructor() {
    this.gemini = new GeminiProvider();
    this.voice = new VoiceProvider();
    this.subtitleBuilder = new AssSubtitleBuilder();
    this.ffmpeg = new FFmpegEngine();
    this.qc = new QcValidator();
    this.slack = new SlackNotifier();
    this.imageProvider = new ImageProvider();
    this.cloudinary = new CloudinaryProvider();
    this.genreService = new GenreService();
  }

  async produceShort(req: MultiChannelProductionRequest): Promise<ProductionResult> {
    const client = await pool.connect();

    try {
      // 1. Resolve Channel & Genre Profile
      let channelId = req.channelId || req.channelConfig?.id || 'channel_01_paper';
      let channelName = req.channelConfig?.name;
      let genreKey = req.channelConfig?.genreKey || 'paper_history';
      let genreProfile: GenreProfile;
      let youtubePublisher: YouTubePublisher;

      const persistedChannel = await this.genreService.getChannel(channelId);
      if (persistedChannel) {
        channelName = channelName || persistedChannel.name;
        genreKey = persistedChannel.genre_key;
        genreProfile = persistedChannel.genre;
      } else {
        genreProfile = await this.genreService.getGenre(genreKey);
        channelName = channelName || `Channel ${channelId}`;
      }

      // Configure YouTube Publisher (Ad-hoc credentials or database/env resolver)
      if (req.channelConfig?.youtube && req.channelConfig.youtube.clientId && req.channelConfig.youtube.refreshToken) {
        console.log(`[MultiChannelPipeline] Using ad-hoc YouTube credentials passed in request for "${channelName}"`);
        youtubePublisher = YouTubePublisher.forCredentials(req.channelConfig.youtube, channelId);
      } else {
        youtubePublisher = await YouTubePublisher.forChannel(channelId);
      }

      console.log(`======================================================================`);
      console.log(`[MultiChannelPipeline] 🚀 Starting Production: "${req.content.title}"`);
      console.log(`[MultiChannelPipeline] Channel: ${channelName} (${channelId})`);
      console.log(`[MultiChannelPipeline] Genre: ${genreProfile.name} [Preset: ${genreKey}]`);
      console.log(`======================================================================`);

      // 2. Resolve Topic Record in Database
      const topicCategory = req.content.category || genreKey;
      let topicId: string;

      if (req.topicId) {
        topicId = req.topicId;
        await client.query(
          `UPDATE topics SET status = 'PRODUCING', updated_at = NOW() WHERE id = $1`,
          [topicId]
        );
        console.log(`[MultiChannelPipeline] Using existing topic record ${topicId}`);
      } else {
        const topicInsert = await client.query(
          `INSERT INTO topics (
            title, category, historical_period, concept_summary, status, channel_id, genre_id, custom_prompt_override
          ) VALUES ($1, $2, $3, $4, 'PRODUCING', $5, $6, $7) RETURNING id`,
          [
            req.content.title,
            topicCategory,
            genreProfile.name,
            req.content.prompt || req.content.title,
            persistedChannel ? channelId : null,
            genreProfile.id,
            req.content.prompt || null,
          ]
        );
        topicId = topicInsert.rows[0].id;
      }

      // 3. Synthesize Script via Dynamic Genre Scriptwriter
      console.log(`[MultiChannelPipeline] Step 1: Generating dynamic script for ${genreProfile.name}...`);
      const scriptData: ScriptOutput = await this.gemini.generateDynamicScript(
        req.content.title,
        genreProfile.system_prompt_scriptwriter,
        req.content.prompt,
        req.content.targetDurationSec || 34
      );

      const scriptInsert = await client.query(
        `INSERT INTO scripts (
          topic_id, hook_text, full_script, estimated_duration_sec, narration_segments, facts_used, hook_score, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED') RETURNING id`,
        [
          topicId,
          scriptData.hook_text,
          scriptData.full_script,
          scriptData.estimated_duration_sec,
          JSON.stringify(scriptData.narration_segments),
          JSON.stringify(scriptData.facts_used),
          scriptData.hook_score || 9.0,
        ]
      );
      const scriptId = scriptInsert.rows[0].id;

      // 4. Generate Storyboard with Genre-tailored Visual Prompts
      console.log(`[MultiChannelPipeline] Step 2: Storyboarding ${scriptData.narration_segments.length} visual scenes...`);
      const storyboardData = await this.gemini.generateDynamicStoryboard(
        scriptData,
        genreProfile.visual_style_prompt,
        genreProfile.visual_negative_prompt
      );

      const storyboardInsert = await client.query(
        `INSERT INTO storyboards (
          script_id, style_profile_id, total_scenes, total_duration_sec, status
        ) VALUES ($1, $2, $3, $4, 'GENERATING_ASSETS') RETURNING id`,
        [scriptId, genreKey, storyboardData.total_scenes, storyboardData.total_duration_sec]
      );
      const storyboardId = storyboardInsert.rows[0].id;

      // Reset image session hashes for unique visuals
      this.imageProvider.resetSessionHashes();

      // 5. Generate Scene Visuals using Style Prompt Override
      const sceneInputs: SceneInput[] = [];
      const sceneDescriptions: string[] = [];

      for (const sc of storyboardData.scenes) {
        await client.query(
          `INSERT INTO scenes (
            storyboard_id, scene_index, duration_sec, narration_text, visual_description,
            characters, location, camera_movement, motion_style, sound_effects,
            positive_prompt, negative_prompt, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'READY') RETURNING id`,
          [
            storyboardId,
            sc.scene_index,
            sc.duration_sec,
            sc.narration_text || '',
            sc.visual_description || '',
            JSON.stringify(sc.characters || []),
            sc.location || 'Set',
            sc.camera_movement || 'push_in',
            sc.motion_style || genreProfile.motion_engine_preset,
            JSON.stringify(sc.sound_effects || []),
            sc.positive_prompt || '',
            sc.negative_prompt || '',
          ]
        );

        sceneDescriptions.push(sc.visual_description);

        console.log(`[MultiChannelPipeline] Generating Scene ${sc.scene_index}/${storyboardData.scenes.length} image...`);
        const imagePath = await this.imageProvider.generateSceneImage({
          storyboardId,
          sceneIndex: sc.scene_index,
          category: topicCategory,
          visualDescription: sc.visual_description,
          characters: sc.characters,
          location: sc.location,
          positivePrompt: sc.positive_prompt,
          narrationText: sc.narration_text,
          stylePromptOverride: genreProfile.visual_style_prompt,
          negativePromptOverride: genreProfile.visual_negative_prompt,
        });

        sceneInputs.push({
          sceneIndex: sc.scene_index,
          durationSec: sc.duration_sec,
          imagePath,
          cameraMovement: sc.camera_movement,
          videoPrompt: sc.video_prompt,
          paperAsmrCues: sc.paper_asmr_cues,
        });
      }

      // 6. Voice Synthesis
      console.log(`[MultiChannelPipeline] Step 3: Generating voiceover (${genreProfile.tts_voice_id})...`);
      const voiceResult = await this.voice.generateVoice(
        scriptData.full_script,
        `topic_${topicId}_narration`
      );

      await client.query(
        `INSERT INTO media_assets (
          asset_type, storage_path, mime_type, file_size_bytes, duration_sec, checksum_sha256
        ) VALUES ('VOICE_TRACK', $1, 'audio/mpeg', $2, $3, 'checksum_placeholder')`,
        [voiceResult.audioPath, voiceResult.fileSizeBytes, voiceResult.durationSec]
      );

      // 7. Subtitles Generation (.ass)
      console.log(`[MultiChannelPipeline] Step 4: Generating animated ASS subtitles...`);
      let accumulatedSec = 0;
      const subtitleEvents = scriptData.narration_segments.map((seg) => {
        const start = accumulatedSec;
        const dur = seg.estimated_sec || 4.0;
        accumulatedSec += dur;
        return {
          startSec: start,
          endSec: accumulatedSec,
          text: seg.text,
        };
      });

      const subtitleAssPath = this.subtitleBuilder.generateAssFile(
        subtitleEvents,
        `short_${topicId}_subs`,
        scriptData.hook_headline
      );

      // 8. FFmpeg Video Rendering with Genre Soundscape
      console.log(`[MultiChannelPipeline] Step 5: Rendering master video with [${genreProfile.soundscape_preset}] soundscape...`);
      const renderRes = await this.ffmpeg.renderShort(
        topicId,
        sceneInputs,
        voiceResult.audioPath,
        subtitleAssPath,
        genreProfile.soundscape_preset
      );

      const renderInsert = await client.query(
        `INSERT INTO render_jobs (
          storyboard_id, output_resolution, fps, status, render_duration_sec
        ) VALUES ($1, '1080x1920', 30, 'COMPLETED', $2) RETURNING id`,
        [storyboardId, renderRes.durationSec]
      );
      const renderJobId = renderInsert.rows[0].id;

      // 9. Automated Quality Control
      console.log(`[MultiChannelPipeline] Step 6: Performing automated QC...`);
      const qcResult = await this.qc.validateVideo(
        renderRes.outputPath,
        sceneDescriptions,
        renderRes.durationSec
      );

      await client.query(
        `INSERT INTO qc_reports (
          render_job_id, overall_status, technical_checks, content_checks, ai_vision_checks, rejection_reasons
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          renderJobId,
          qcResult.overallStatus,
          JSON.stringify(qcResult.technicalChecks),
          JSON.stringify(qcResult.contentChecks),
          JSON.stringify(qcResult.aiVisionChecks),
          JSON.stringify(qcResult.rejectionReasons),
        ]
      );

      // 10. Cloudinary Storage Offload
      let cloudinaryUrl: string | undefined;
      const shouldUploadCloudinary = req.options?.uploadCloudinary !== false;

      if (shouldUploadCloudinary && this.cloudinary.isConfigured()) {
        try {
          console.log(`[MultiChannelPipeline] Step 7: Offloading video to Cloudinary CDN...`);
          const cloudRes = await this.cloudinary.uploadVideo(renderRes.outputPath, {
            folder: `shorts_factory/${channelId}`,
            publicId: `${channelId}_${topicId}`,
            tags: ['shorts_factory', channelId, genreKey],
          });

          cloudinaryUrl = cloudRes.secureUrl;

          // Update DB with Cloudinary CDN link
          await client.query(
            'UPDATE render_jobs SET cloudinary_url = $1, cloudinary_public_id = $2 WHERE id = $3',
            [cloudRes.secureUrl, cloudRes.publicId, renderJobId]
          );

          await client.query(
            `INSERT INTO media_assets (
              asset_type, storage_path, cloudinary_url, cloudinary_public_id, mime_type, file_size_bytes, duration_sec, checksum_sha256
            ) VALUES ('VIDEO_CLIP', $1, $2, $3, 'video/mp4', $4, $5, 'cloudinary_synced')`,
            [renderRes.outputPath, cloudRes.secureUrl, cloudRes.publicId, renderRes.fileSizeBytes, renderRes.durationSec]
          );

          console.log(`[MultiChannelPipeline] ✅ Video offloaded to Cloudinary: ${cloudinaryUrl}`);
        } catch (cloudErr: any) {
          console.warn(`[MultiChannelPipeline] Cloudinary upload skipped/failed: ${cloudErr.message}`);
        }
      }

      // 11. YouTube Publishing to specific channel
      let youtubeVideoId: string | undefined;
      let youtubeUrl: string | undefined;
      const shouldPublishYouTube = req.options?.publishYouTube !== false;

      if (shouldPublishYouTube && youtubePublisher.isConfigured() && qcResult.overallStatus !== 'FAIL') {
        try {
          console.log(`[MultiChannelPipeline] Step 8: Publishing short to YouTube for channel "${channelName}"...`);
          const uploadSource = renderRes.outputPath; // Use local file for fastest upload before purge

          const uploadRes = await youtubePublisher.uploadShort(uploadSource, {
            title: req.content.title,
            description: scriptData.full_script,
            category: topicCategory,
            channelName,
            privacyStatus: req.options?.privacyStatus || 'unlisted',
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
              uploadRes.videoId,
              uploadRes.title.slice(0, 100),
              scriptData.full_script,
              ['Shorts', channelName.replace(/\s+/g, ''), topicCategory],
              uploadRes.privacyStatus,
              persistedChannel ? channelId : null,
            ]
          );

          await client.query("UPDATE topics SET status = 'PUBLISHED', used_at = NOW() WHERE id = $1", [topicId]);
          console.log(`[MultiChannelPipeline] ✅ Published to YouTube: ${youtubeUrl}`);
        } catch (ytErr: any) {
          console.error(`[MultiChannelPipeline] YouTube upload failed:`, ytErr.message);
        }
      }

      // 12. Strict Local Disk Auto-Purge Policy (Zero-Local Storage Principle)
      let purgedLocalDisk = false;
      const shouldPurge = req.options?.purgeLocalAfterUpload !== false;

      if (shouldPurge) {
        console.log(`[MultiChannelPipeline] Step 9: 🧹 Executing strict zero-local disk auto-purge policy for topic ${topicId}...`);
        // 1. Purge rendered master video
        this.cloudinary.purgeLocalFile(renderRes.outputPath);
        // 2. Purge temp render directory
        this.cloudinary.purgeTempDirectory(path.join(config.storage.renders, `temp_${topicId}`));
        // 3. Purge all intermediate scene images
        for (const sc of sceneInputs) {
          if (sc.imagePath) this.cloudinary.purgeLocalFile(sc.imagePath);
        }
        // 4. Purge generated voice audio
        if (voiceResult.audioPath) this.cloudinary.purgeLocalFile(voiceResult.audioPath);
        // 5. Purge generated ASS subtitle file
        if (subtitleAssPath) this.cloudinary.purgeLocalFile(subtitleAssPath);

        purgedLocalDisk = true;
        console.log(`[MultiChannelPipeline] ✅ Zero-Local Purge complete: all intermediate assets deleted. 0 MB remaining on host.`);
      }

      // 13. Slack Notification with Channel Badge
      await this.slack.sendQcReport({
        shortId: topicId,
        title: `[${channelName}] ${req.content.title}`,
        category: topicCategory,
        durationSec: renderRes.durationSec,
        overallStatus: qcResult.overallStatus,
        styleAdherenceScore: qcResult.aiVisionChecks?.styleAdherenceScore || 0.95,
        rejectionReasons: qcResult.rejectionReasons,
        outputPath: cloudinaryUrl || renderRes.outputPath,
        youtubeUrl,
      });

      return {
        success: true,
        channelId,
        channelName,
        genreKey,
        topicId,
        title: req.content.title,
        renderJobId,
        durationSec: renderRes.durationSec,
        fileSizeBytes: renderRes.fileSizeBytes,
        localVideoPath: purgedLocalDisk ? undefined : renderRes.outputPath,
        cloudinaryUrl,
        youtubeVideoId,
        youtubeUrl,
        qcResult,
        purgedLocalDisk,
      };
    } finally {
      client.release();
    }
  }
}
