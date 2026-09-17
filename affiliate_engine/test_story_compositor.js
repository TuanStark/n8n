const StoryCompositor = require('./story_compositor');
const path = require('path');
const fs = require('fs');

async function test() {
  console.log('--- TESTING STORY COMPOSITOR ---');
  const compositor = new StoryCompositor();
  const outputPath = path.resolve(__dirname, 'test_story_output.jpg');

  // Test with pure fallback (no input image)
  const res1 = await compositor.composeStory({
    productName: 'Kệ Để Dao Thớt Đa Năng Thông Minh Inox 304',
    hookText: 'GIAN BẾP BỪA BỘN? 1 MÓN ĐỒ GIẢI QUYẾT TẤT CẢ TRONG 30 GIÂY!',
    subText: 'Đừng để căn bếp ẩm mốc lộn xộn làm bạn mệt mỏi mỗi khi nấu ăn!',
    price: 89000,
    originalPrice: 159000,
    discountPercent: 44,
    rating: 4.9,
    soldCount: '3.4k+',
    ctaText: '👉 BẤM XEM BÀI REVIEW TRÊN TRANG',
    theme: 'ORANGE',
    outputPath: outputPath
  });

  console.log('Result:', res1);
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log(`Success! Generated story file size: ${stats.size} bytes. Dimensions: ${res1.width}x${res1.height}`);
  } else {
    throw new Error('Output file was not created!');
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
