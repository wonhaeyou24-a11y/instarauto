const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// 텍스트 자동 줄바꿈 함수
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  if (!text) return;
  const words = text.split(' ');
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

// 개별 슬라이드 그리기
async function renderSlide(slide, index, totalSlides) {
  const width = 1080;
  const height = 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle = '#1e1e24';
  ctx.fillRect(0, 0, width, height);

  // 페이지 번호 (우측 상단)
  ctx.fillStyle = '#8e8e93';
  ctx.font = '28px sans-serif';
  ctx.fillText(`${index + 1} / ${totalSlides}`, width - 150, 100);

  // 슬라이드 종류별 텍스트
  if (slide.type === 'cover') {
    ctx.fillStyle = '#ff3366';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('HOT TOPIC', 100, 380);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px sans-serif';
    wrapText(ctx, slide.title || '', 100, 480, 880, 85);

    if (slide.subtitle) {
      ctx.fillStyle = '#a0a0a5';
      ctx.font = '36px sans-serif';
      wrapText(ctx, slide.subtitle, 100, 720, 880, 50);
    }
  } else if (slide.type === 'body') {
    if (slide.step) {
      ctx.fillStyle = '#4da6ff';
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText(`STEP ${slide.step}`, 100, 320);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px sans-serif';
    wrapText(ctx, slide.title || '', 100, 420, 880, 75);

    ctx.fillStyle = '#d1d1d6';
    ctx.font = '36px sans-serif';
    wrapText(ctx, slide.content || '', 100, 600, 880, 60);
  } else if (slide.type === 'outro') {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    wrapText(ctx, slide.title || '저장해두고 꺼내보세요!', width / 2, 480, 880, 80);

    if (slide.subtitle) {
      ctx.fillStyle = '#ff9900';
      ctx.font = '36px sans-serif';
      wrapText(ctx, slide.subtitle, width / 2, 650, 880, 50);
    }
  }

  // 이미지 파일 저장 (public/generated 폴더)
  const buffer = canvas.toBuffer('image/png');
  const outputDir = path.join(__dirname, 'public', 'generated');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `slide_${Date.now()}_${index + 1}.png`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, buffer);

  return `/generated/${fileName}`;
}

// 전체 슬라이드 생성
async function generateCarouselImages(slides) {
  const imageUrls = [];
  for (let i = 0; i < slides.length; i++) {
    const url = await renderSlide(slides[i], i, slides.length);
    imageUrls.push(url);
  }
  return imageUrls;
}

module.exports = { generateCarouselImages };
