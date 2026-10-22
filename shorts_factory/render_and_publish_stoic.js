const path = require('path');
const { FFmpegEngine } = require('./dist/render/ffmpegEngine');
const { YouTubePublisher } = require('./dist/publish/youtubePublisher');
const { pool } = require('./dist/db/pool');

async function main() {
  const topicId = '214d083b-68bc-4ef0-a7a9-12035988c6a7';
  const scenes = [
    { sceneIndex: 1, durationSec: 3.5, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_1.jpg' },
    { sceneIndex: 2, durationSec: 4.0, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_2.jpg' },
    { sceneIndex: 3, durationSec: 4.0, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_3.jpg' },
    { sceneIndex: 4, durationSec: 4.5, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_4.jpg' },
    { sceneIndex: 5, durationSec: 4.0, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_5.jpg' },
    { sceneIndex: 6, durationSec: 5.0, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_6.jpg' },
    { sceneIndex: 7, durationSec: 5.0, imagePath: '/app/storage/raw/scene_74a2954d-49a7-4c09-860b-19b919e1e5e9_7.jpg' },
  ];

  const audioPath = `/app/storage/audio/topic_${topicId}_narration.mp3`;
  const subtitleAssPath = `/app/storage/subtitles/short_${topicId}_subs.ass`;

  console.log('🎬 Starting Master Re-Render with REAL AI artwork...');
  const ffmpeg = new FFmpegEngine();
  const renderRes = await ffmpeg.renderShort(
    topicId,
    scenes,
    audioPath,
    subtitleAssPath,
    'dark_ambient'
  );

  console.log('✅ Render completed! File size:', (renderRes.fileSizeBytes / 1024 / 1024).toFixed(2), 'MB');
  console.log('Output Path:', renderRes.outputPath);

  // Upload to YouTube
  console.log('🚀 Uploading Master Video to YouTube (Channel 3: Tuấn Lê / Iron Mind)...');
  const publisher = await YouTubePublisher.forChannel('channel_03_stoic');
  
  const scriptText = `When you lose your temper, you surrender your mind to a barking dog. Marcus Aurelius did not rage at the senators who plotted his murder; he noted their smallness and remained stone. To flare up in anger is to confess that another human being controls your inner citadel. You are not a wild beast reacting to every provocation, governed by circumstance. True power is absolute silence while the world around you screams. The emperor ruled an empire through unyielding stillness, knowing that when you lose your temper, you surrender your mind to a barking dog.`;

  const uploadRes = await publisher.uploadShort(renderRes.outputPath, {
    title: 'Marcus Aurelius: The Brutal Rule for Conquering Anger',
    description: scriptText,
    category: 'stoicism',
    channelName: 'Iron Mind (Dark Stoicism)',
    privacyStatus: 'public',
  });

  console.log('🎉 Uploaded successfully to YouTube!');
  console.log('YouTube Video ID:', uploadRes.videoId);
  console.log('YouTube URL:', uploadRes.youtubeUrl);

  // Update DB
  await pool.query(
    `UPDATE youtube_videos
     SET youtube_video_id = $1, upload_status = 'UPLOADED', privacy_status = 'public', updated_at = NOW()
     WHERE topic_id = $2`,
    [uploadRes.videoId, topicId]
  ).catch(async () => {
    // If update failed or 0 rows, insert
    await pool.query(
      `INSERT INTO youtube_videos (topic_id, render_job_id, youtube_video_id, title, description, tags, privacy_status, upload_status, channel_id)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 'public', 'UPLOADED', 'channel_03_stoic')`,
      [topicId, uploadRes.videoId, 'Marcus Aurelius: The Brutal Rule for Conquering Anger', scriptText, ['Shorts', 'stoicism', 'marcusaurelius', 'darkstoic']]
    );
  });

  await pool.query("UPDATE topics SET status = 'PUBLISHED' WHERE id = $1", [topicId]);
  console.log('✅ Database updated successfully!');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
