import { pool } from '../db/pool';
import { GeminiProvider } from '../providers/geminiProvider';
import { VoiceProvider } from '../providers/voiceProvider';
import { AssSubtitleBuilder } from '../render/assSubtitleBuilder';
import { FFmpegEngine, SceneInput } from '../render/ffmpegEngine';
import { QcValidator } from '../qc/qcValidator';
import { SlackNotifier } from '../notifications/slackNotifier';
import { YouTubePublisher } from '../publish/youtubePublisher';
import { ImageProvider } from '../providers/imageProvider';

export class PipelineRunner {
  private gemini: GeminiProvider;
  private voice: VoiceProvider;
  private subtitleBuilder: AssSubtitleBuilder;
  private ffmpeg: FFmpegEngine;
  private qc: QcValidator;
  private slack: SlackNotifier;
  private youtube: YouTubePublisher;
  private imageProvider: ImageProvider;

  constructor() {
    this.gemini = new GeminiProvider();
    this.voice = new VoiceProvider();
    this.subtitleBuilder = new AssSubtitleBuilder();
    this.ffmpeg = new FFmpegEngine();
    this.qc = new QcValidator();
    this.slack = new SlackNotifier();
    this.youtube = new YouTubePublisher();
    this.imageProvider = new ImageProvider();
  }

  async runFullPipelineForTopic(topicId?: string): Promise<any> {
    const client = await pool.connect();
    try {
      // 1. Select Topic
      let topicQuery = 'SELECT * FROM topics WHERE id = $1';
      let topicParams = [topicId];

      if (!topicId) {
        topicQuery = "SELECT * FROM topics WHERE status = 'IDEA' ORDER BY potential_score DESC LIMIT 1";
        topicParams = [];
      }

      const topicRes = await client.query(topicQuery, topicParams);
      if (topicRes.rows.length === 0) {
        throw new Error('No available topics found in status IDEA');
      }

      const topic = topicRes.rows[0];
      console.log(`[Pipeline] Processing Topic: "${topic.title}" (${topic.category})...`);

      // Update status to PRODUCING
      await client.query("UPDATE topics SET status = 'PRODUCING', updated_at = NOW() WHERE id = $1", [topic.id]);

      // 2. Research Engine
      console.log(`[Pipeline] Step 1: Researching historical facts...`);
      const researchData = await this.gemini.researchHistoricalTopic(
        topic.title,
        topic.category,
        topic.historical_period
      );

      const researchInsert = await client.query(
        `INSERT INTO research_documents (
          topic_id, historical_period, key_facts, timeline, important_people, locations, conflicts_detected, confidence_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          topic.id,
          researchData.historical_period,
          JSON.stringify(researchData.key_facts),
          JSON.stringify(researchData.timeline),
          JSON.stringify(researchData.important_people),
          JSON.stringify(researchData.locations),
          JSON.stringify(researchData.conflicts_detected),
          researchData.confidence_score,
        ]
      );
      const researchId = researchInsert.rows[0].id;

      // 3. Script Engine
      console.log(`[Pipeline] Step 2: Synthesizing hook-optimized script...`);
      const scriptData = await this.gemini.generateShortsScript(topic.title, researchData, 32);

      const scriptInsert = await client.query(
        `INSERT INTO scripts (
          topic_id, research_id, hook_text, full_script, estimated_duration_sec, narration_segments, facts_used, hook_score, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPROVED') RETURNING id`,
        [
          topic.id,
          researchId,
          scriptData.hook_text,
          scriptData.full_script,
          scriptData.estimated_duration_sec,
          JSON.stringify(scriptData.narration_segments),
          JSON.stringify(scriptData.facts_used),
          scriptData.hook_score,
        ]
      );
      const scriptId = scriptInsert.rows[0].id;

      // 4. Storyboard Engine
      console.log(`[Pipeline] Step 3: Decomposing script into Paper Theater scenes...`);
      const styleRes = await client.query("SELECT * FROM visual_style_profiles WHERE id = 'paper-theater-v1'");
      const styleProfile = styleRes.rows[0];

      const storyboardData = await this.gemini.generateStoryboard(scriptData, {
        global_positive: styleProfile.global_positive_prompt,
        global_negative: styleProfile.global_negative_prompt,
      });

      const storyboardInsert = await client.query(
        `INSERT INTO storyboards (
          script_id, style_profile_id, total_scenes, total_duration_sec, status
        ) VALUES ($1, $2, $3, $4, 'GENERATING_ASSETS') RETURNING id`,
        [
          scriptId,
          'paper-theater-v1',
          storyboardData.total_scenes,
          storyboardData.total_duration_sec,
        ]
      );
      const storyboardId = storyboardInsert.rows[0].id;

      // Insert scenes
      const sceneInputs: SceneInput[] = [];
      const sceneDescriptions: string[] = [];

      for (const sc of storyboardData.scenes) {
        const sceneInsert = await client.query(
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
            sc.location || 'Paper Theater Set',
            sc.camera_movement || 'fixed_proscenium',
            sc.motion_style || 'stop_motion_12fps',
            JSON.stringify(sc.sound_effects || []),
            sc.positive_prompt || '',
            sc.negative_prompt || '',
          ]
        );

        sceneDescriptions.push(sc.visual_description);

        // Generate authentic AI Papercraft Diorama visual artwork
        console.log(`[Pipeline] Generating visual artwork for Scene ${sc.scene_index}/${storyboardData.scenes.length}...`);
        const imagePath = await this.imageProvider.generateSceneImage({
          storyboardId,
          sceneIndex: sc.scene_index,
          category: topic.category,
          visualDescription: sc.visual_description,
          characters: sc.characters,
          location: sc.location,
          positivePrompt: sc.positive_prompt,
          narrationText: sc.narration_text,  // Pass narration so image matches voiceover
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

      // 5. Voice Synthesis
      console.log(`[Pipeline] Step 4: Generating narration audio...`);
      const voiceResult = await this.voice.generateVoice(
        scriptData.full_script,
        `topic_${topic.id}_narration`
      );

      // Save media asset record
      await client.query(
        `INSERT INTO media_assets (
          asset_type, storage_path, mime_type, file_size_bytes, duration_sec, checksum_sha256
        ) VALUES ('VOICE_TRACK', $1, 'audio/mpeg', $2, $3, 'checksum_placeholder')`,
        [voiceResult.audioPath, voiceResult.fileSizeBytes, voiceResult.durationSec]
      );

      // 6. Subtitles Generation (.ass) — burned directly into master video
      console.log(`[Pipeline] Step 5: Building animated ASS subtitles with Hook Banner...`);
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
        `short_${topic.id}_subs`,
        scriptData.hook_headline
      );

      // 7. Video Rendering via FFmpeg — Burned ASS Subtitles with Hook Banner
      console.log(`[Pipeline] Step 6: Rendering master 9:16 vertical short in FFmpeg (with burned subtitles)...`);
      const renderRes = await this.ffmpeg.renderShort(
        topic.id,
        sceneInputs,
        voiceResult.audioPath,
        subtitleAssPath
      );

      // Save render job
      const renderInsert = await client.query(
        `INSERT INTO render_jobs (
          storyboard_id, output_resolution, fps, status, render_duration_sec
        ) VALUES ($1, '1080x1920', 30, 'COMPLETED', $2) RETURNING id`,
        [storyboardId, renderRes.durationSec]
      );
      const renderJobId = renderInsert.rows[0].id;

      // 8. Quality Control (QC)
      console.log(`[Pipeline] Step 7: Performing automated Quality Control checks...`);
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

      // 9. YouTube Publishing
      let youtubeVideoId: string | undefined;
      let youtubeUrl: string | undefined;

      if (this.youtube.isConfigured() && qcResult.overallStatus !== 'FAIL') {
        console.log(`[Pipeline] Step 8: Publishing short to YouTube (#Shorts)...`);
        try {
          const uploadRes = await this.youtube.uploadShort(renderRes.outputPath, {
            title: topic.title,
            description: scriptData.full_script,
            category: topic.category,
            privacyStatus: 'unlisted',
          });

          youtubeVideoId = uploadRes.videoId;
          youtubeUrl = uploadRes.youtubeUrl;

          // Record in shorts_factory.youtube_videos
          await client.query(
            `INSERT INTO youtube_videos (
              topic_id, render_job_id, youtube_video_id, title, description, tags, privacy_status, upload_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UPLOADED')`,
            [
              topic.id,
              renderJobId,
              uploadRes.videoId,
              uploadRes.title.slice(0, 100),
              scriptData.full_script,
              ['Shorts', 'history', 'papertheater', topic.category],
              uploadRes.privacyStatus,
            ]
          );
          console.log(`[Pipeline] Successfully published to YouTube: ${uploadRes.youtubeUrl}`);
        } catch (uploadErr) {
          console.error(`[Pipeline] YouTube upload error:`, uploadErr);
        }
      }

      // Update topic status
      const nextTopicStatus = (qcResult.overallStatus !== 'FAIL' && youtubeVideoId)
        ? 'PUBLISHED'
        : (qcResult.overallStatus === 'FAIL' ? 'IDEA' : 'RESEARCH_READY');

      await client.query('UPDATE topics SET status = $1, used_at = NOW() WHERE id = $2', [
        nextTopicStatus,
        topic.id,
      ]);

      console.log(`[Pipeline] Pipeline finished with QC status: ${qcResult.overallStatus}`);

      // Dispatch interactive review card to Slack
      await this.slack.sendQcReport({
        shortId: topic.id,
        title: topic.title,
        category: topic.category,
        durationSec: renderRes.durationSec,
        overallStatus: qcResult.overallStatus,
        styleAdherenceScore: qcResult.aiVisionChecks.styleAdherenceScore,
        rejectionReasons: qcResult.rejectionReasons,
        outputPath: renderRes.outputPath,
        youtubeUrl,
      });

      return {
        success: true,
        topicId: topic.id,
        title: topic.title,
        renderJobId,
        outputPath: renderRes.outputPath,
        durationSec: renderRes.durationSec,
        fileSizeBytes: renderRes.fileSizeBytes,
        qcResult,
        youtubeVideoId,
        youtubeUrl,
      };
    } finally {
      client.release();
    }
  }
}
