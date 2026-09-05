const Gemini = require('./ai_engine');
const ai = new Gemini();

console.log('Gemini API Key exists:', Boolean(ai.apiKey));

async function run() {
  const result = await ai.scoreProduct({
    product_name: 'Kệ treo nắp vung xoong nồi gắn tường thông minh',
    price: 79000,
    rating_star: 4.88,
    historical_sold: 4820,
    shop_type: 'OFFICIAL_MALL',
    raw_specs: { material: 'Thép carbon không gỉ', installation: 'Dán tường không khoan' }
  });
  console.log('--- SCORING RESULT ---');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n--- GENERATING CONTENT ---');
  const content = await ai.generateContent({
    product_name: 'Kệ treo nắp vung xoong nồi gắn tường thông minh',
    price: 79000,
    rating_star: 4.88,
    historical_sold: 4820,
    shop_type: 'OFFICIAL_MALL',
    raw_specs: { material: 'Thép carbon không gỉ', installation: 'Dán tường không khoan' }
  }, result.recommended_angle || 'PROBLEM_SOLUTION');
  console.log(JSON.stringify(content, null, 2));

  console.log('\n--- QUALITY CONTROL INSPECTION ---');
  const qa = await ai.inspectQuality(content, {
    product_name: 'Kệ treo nắp vung xoong nồi gắn tường thông minh',
    price: 79000,
    raw_specs: { material: 'Thép carbon không gỉ' }
  });
  console.log(JSON.stringify(qa, null, 2));
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
