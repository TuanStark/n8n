const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execAsync = promisify(exec);

async function run() {
  const storyboardId = '51b63d9f-7c8a-4972-b10d-43a075c65824';
  const topicId = '7fcc8823-a4d8-4bc1-b417-4c92b4c5a3b0';

  const img1 = '/app/storage/raw/scene_' + storyboardId + '_1.jpg';
  const img2 = '/app/storage/raw/scene_' + storyboardId + '_2.jpg';
  const img3 = '/app/storage/raw/scene_' + storyboardId + '_3.jpg';
  const img4 = '/app/storage/raw/scene_' + storyboardId + '_4.jpg';
  const img5 = '/app/storage/raw/scene_' + storyboardId + '_5.jpg';
  const audio = '/app/storage/audio/topic_' + topicId + '_narration.mp3';
  const subs = '/app/storage/subtitles/short_' + topicId + '_subs.ass';
  const asmr = '/app/storage/renders/paper_asmr_34s.mp3';
  if (!fs.existsSync(asmr)) {
    console.log('Synthesizing ASMR bed...');
    const asmrCmd = `ffmpeg -y -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.08" -f lavfi -i "anoisesrc=c=brown:r=48000:a=0.04" -filter_complex "[0:a]bandpass=f=2200:width_type=h:w=1400,volume=1.2[paper];[1:a]lowpass=f=550,volume=0.6[thud];[paper][thud]amix=inputs=2[asmr]" -map "[asmr]" -t 34 "${asmr}"`;
    await execAsync(asmrCmd);
  }
  const output = '/app/storage/renders/' + topicId + '_master_smooth.mp4';

  console.log('Rendering 60FPS Silky Smooth Master Short with xfade transitions...');

  const filterComplex = [
    "[0:v]scale=1200:2133,crop=1080:1920:x='(in_w-out_w)/2':y='(in_h-out_h)*(1-n/276)',fps=60,setsar=1[v0]",
    "[1:v]scale=1200:2133,crop=1080:1920:x='(in_w-out_w)*(n/456)':y='(in_h-out_h)*(0.3+0.4*n/456)',fps=60,setsar=1[v1]",
    "[2:v]scale='1080*(1+0.08*n/576)':'-1':eval=frame,crop=1080:1920,fps=60,setsar=1[v2]",
    "[3:v]scale=1200:2133,crop=1080:1920:x='(in_w-out_w)*(1-n/456)':y='(in_h-out_h)*(1-n/456)',fps=60,setsar=1[v3]",
    "[4:v]scale='1080*(1+0.07*n/300)':'-1':eval=frame,crop=1080:1920,fps=60,setsar=1[v4]",
    "[v0][v1]xfade=transition=fade:duration=0.6:offset=4.0[x1]",
    "[x1][v2]xfade=transition=smoothleft:duration=0.6:offset=11.0[x2]",
    "[x2][v3]xfade=transition=fade:duration=0.6:offset=20.0[x3]",
    "[x3][v4]xfade=transition=fade:duration=0.6:offset=27.0[x4]",
    `[x4]vignette=PI/5,ass='${subs}'[vout]`,
    "[5:a]volume=1.0[voice]",
    "[6:a]volume=0.16[asmr_a]",
    "[voice][asmr_a]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:LRA=7:tp=-1[aout]"
  ].join(';');

  const args = [
    '-y',
    '-loop', '1', '-t', '4.6', '-i', img1,
    '-loop', '1', '-t', '7.6', '-i', img2,
    '-loop', '1', '-t', '9.6', '-i', img3,
    '-loop', '1', '-t', '7.6', '-i', img4,
    '-loop', '1', '-t', '5.0', '-i', img5,
    '-i', audio,
    '-i', asmr,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-c:a', 'aac',
    '-b:a', '192k',
    output
  ];

  const cmd = `ffmpeg ${args.map(a => a.includes(' ') || a.includes(';') || a.includes('=') ? `"${a}"` : a).join(' ')}`;
  console.log('Running ffmpeg...');
  await execAsync(cmd);
  console.log('✅ Render complete! File saved at:', output);
}

run().catch(console.error);
