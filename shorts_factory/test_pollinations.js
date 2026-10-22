async function testModel(model) {
  const prompt = 'ancient Roman weathered marble sculpture of Marcus Aurelius';
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1344&model=${model}&nologo=true`;
  try {
    const res = await fetch(url);
    console.log(`Model [${model}] HTTP Status:`, res.status);
    if (!res.ok) {
      const text = await res.text();
      console.log(`  Error:`, text.slice(0, 120));
    } else {
      const buf = await res.arrayBuffer();
      console.log(`  SUCCESS! Size:`, buf.byteLength);
    }
  } catch(e) {
    console.error(`  Fetch error:`, e.message);
  }
}

async function run() {
  const models = ['', 'flux', 'turbo', 'flux-realism', 'flux-anime', 'flux-3d', 'midjourney'];
  for (const m of models) {
    await testModel(m);
  }
}
run();
