const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WIDTH = 1080;
const HEIGHT = 1080;
const SAFE = 96;
const CONTENT_WIDTH = WIDTH - SAFE * 2;
// 한글 폰트(나눔고딕) 우선 적용
const FONT_FAMILY = '"NanumGothic", "Nanum Gothic", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

const LAYOUTS = {
  modern: { label: '01 모던', description: '풀스크린 사진 배경 + 텍스트 오버레이' },
  editorial: { label: '02 에디토리얼', description: '상단 사진 프레임 + 하단 매거진 텍스트' },
  split: { label: '03 스플릿', description: '좌우 5:5 사진/콘텐츠 분할 레이아웃' },
  card: { label: '04 카드', description: '중앙 라운드 사진 카드 + 정보 박스' },
  minimal: { label: '05 미니멀', description: '하단 사진 바 + 여백 중심 타이포그래피' }
};

// 외부 이미지 안전 다운로드 헬퍼
async function fetchImageSafe(url) {
  if (!url || !url.startsWith('http')) return null;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const buffer = Buffer.from(response.data, 'binary');
    return await loadImage(buffer);
  } catch (err) {
    return null;
  }
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getLines(ctx, text, maxWidth) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const chars = Array.from(paragraph);
    let line = '';
    for (const char of chars) {
      const test = line + char;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line.trimEnd());
        line = char;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines;
}

function fitText(ctx, text, options = {}) {
  const {
    maxWidth,
    maxHeight,
    maxFontSize = 64,
    minFontSize = 24,
    fontWeight = '700',
    lineHeightRatio = 1.35,
    maxLines = Infinity
  } = options;

  const safeText = normalizeText(text);
  if (!safeText) return { fontSize: minFontSize, lineHeight: minFontSize * lineHeightRatio, lines: [] };

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    ctx.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
    const lines = getLines(ctx, safeText, maxWidth);
    const lineHeight = Math.round(fontSize * lineHeightRatio);
    const height = lines.length * lineHeight;

    if (lines.length <= maxLines && height <= maxHeight) {
      return { fontSize, lineHeight, lines, height };
    }
  }

  ctx.font = `${fontWeight} ${minFontSize}px ${FONT_FAMILY}`;
  const lines = getLines(ctx, safeText, maxWidth);
  const lineHeight = Math.round(minFontSize * lineHeightRatio);
  return { fontSize: minFontSize, lineHeight, lines, height: lines.length * lineHeight };
}

function drawTextBlock(ctx, text, options = {}) {
  const {
    x, y, width, height,
    maxFontSize = 64, minFontSize = 24,
    fontWeight = '700', lineHeightRatio = 1.35,
    maxLines = Infinity, color = '#ffffff',
    align = 'left', vertical = 'top'
  } = options;

  const fitted = fitText(ctx, text, {
    maxWidth: width, maxHeight: height,
    maxFontSize, minFontSize, fontWeight, lineHeightRatio, maxLines
  });

  ctx.font = `${fontWeight} ${fitted.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  let startY = y;
  if (vertical === 'middle') startY = y + Math.max(0, (height - fitted.height) / 2);
  else if (vertical === 'bottom') startY = y + Math.max(0, height - fitted.height);

  for (let i = 0; i < fitted.lines.length; i++) {
    let drawX = x;
    if (align === 'center') drawX = x + width / 2;
    if (align === 'right') drawX = x + width;
    ctx.fillText(fitted.lines[i], drawX, startY + i * fitted.lineHeight);
  }

  return { ...fitted, startY };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCoverImage(ctx, img, x, y, w, h) {
  if (!img) return;
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;
  let sx, sy, sw, sh;

  if (imgRatio > targetRatio) {
    sh = img.height;
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = img.width / targetRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawPageNumber(ctx, index, total, isDarkBg = true) {
  ctx.fillStyle = isDarkBg ? '#cbd5e1' : '#64748b';
  ctx.font = `700 24px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, WIDTH - SAFE, SAFE);
}

// 템플릿별 렌더링 함수
function renderModern(ctx, slide, index, total, bgImg) {
  if (bgImg) {
    drawCoverImage(ctx, bgImg, 0, 0, WIDTH, HEIGHT);
    // 어두운 오버레이 딤 처리
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  drawPageNumber(ctx, index, total, true);
  const accent = '#f43f5e';

  ctx.fillStyle = accent;
  ctx.fillRect(SAFE, 170, 140, 8);

  if (slide.type === 'cover') {
    ctx.fillStyle = accent;
    ctx.font = `800 32px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('HOT TREND', SAFE, 215);

    drawTextBlock(ctx, slide.title, {
      x: SAFE, y: 280, width: CONTENT_WIDTH, height: 360,
      maxFontSize: 76, minFontSize: 40, maxLines: 5,
      fontWeight: '800', lineHeightRatio: 1.25, color: '#ffffff'
    });
    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE, y: 700, width: CONTENT_WIDTH, height: 140,
      maxFontSize: 36, minFontSize: 24, maxLines: 3,
      fontWeight: '500', color: '#e2e8f0'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = accent;
    ctx.font = `800 34px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`POINT ${slide.step || String(index).padStart(2, '0')}`, SAFE, 195);

    drawTextBlock(ctx, slide.title, {
      x: SAFE, y: 260, width: CONTENT_WIDTH, height: 240,
      maxFontSize: 64, minFontSize: 36, maxLines: 4,
      fontWeight: '800', lineHeightRatio: 1.25, color: '#ffffff'
    });
    drawTextBlock(ctx, slide.content, {
      x: SAFE, y: 550, width: CONTENT_WIDTH, height: 320,
      maxFontSize: 38, minFontSize: 24, maxLines: 7,
      fontWeight: '500', lineHeightRatio: 1.55, color: '#f1f5f9'
    });
  } else {
    drawTextBlock(ctx, slide.title || '저장해두고 필요할 때 꺼내보세요!', {
      x: SAFE, y: 360, width: CONTENT_WIDTH, height: 280,
      maxFontSize: 68, minFontSize: 38, maxLines: 4,
      fontWeight: '800', lineHeightRatio: 1.25, color: '#ffffff', align: 'center', vertical: 'middle'
    });
    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE, y: 710, width: CONTENT_WIDTH, height: 120,
      maxFontSize: 34, minFontSize: 22, maxLines: 2,
      fontWeight: '600', color: '#f43f5e', align: 'center', vertical: 'middle'
    });
  }
}

function renderEditorial(ctx, slide, index, total, bgImg) {
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (bgImg) {
    ctx.save();
    roundRect(ctx, SAFE, 150, CONTENT_WIDTH, 420, 24);
    ctx.clip();
    drawCoverImage(ctx, bgImg, SAFE, 150, CONTENT_WIDTH, 420);
    ctx.restore();
  }

  drawPageNumber(ctx, index, total, false);

  const textY = bgImg ? 610 : 220;
  const textH = bgImg ? 340 : 680;

  if (slide.type === 'cover') {
    drawTextBlock(ctx, slide.title, {
      x: SAFE, y: textY, width: CONTENT_WIDTH, height: textH - 100,
      maxFontSize: 64, minFontSize: 36, maxLines: 4,
      fontWeight: '800', lineHeightRatio: 1.25, color: '#0f172a'
    });
    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE, y: textY + textH - 80, width: CONTENT_WIDTH, height: 80,
      maxFontSize: 30, minFontSize: 20, maxLines: 2,
      fontWeight: '600', color: '#64748b'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = '#4f46e5';
    ctx.font = `800 32px ${FONT_FAMILY}`;
    ctx.fillText(`0${slide.step || index}`, SAFE, textY);

    drawTextBlock(ctx, slide.title, {
      x: SAFE, y: textY + 45, width: CONTENT_WIDTH, height: 120,
      maxFontSize: 52, minFontSize: 32, maxLines: 2,
      fontWeight: '800', color: '#0f172a'
    });
    drawTextBlock(ctx, slide.content, {
      x: SAFE, y: textY + 180, width: CONTENT_WIDTH, height: textH - 180,
      maxFontSize: 34, minFontSize: 22, maxLines: 5,
      fontWeight: '500', lineHeightRatio: 1.5, color: '#334155'
    });
  } else {
    drawTextBlock(ctx, slide.title, {
      x: SAFE, y: textY, width: CONTENT_WIDTH, height: textH,
      maxFontSize: 58, minFontSize: 34, maxLines: 4,
      fontWeight: '800', color: '#0f172a', align: 'center', vertical: 'middle'
    });
  }
}

async function renderSlide(slide = {}, index, totalSlides, options = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const layout = LAYOUTS[options.layout] ? options.layout : 'modern';

  ctx.imageSmoothingEnabled = true;

  // 슬라이드 개별 이미지 로딩
  const imgUrl = slide.imageUrl || options.globalImageUrl || null;
  const loadedImg = imgUrl ? await fetchImageSafe(imgUrl) : null;

  if (layout === 'editorial' || layout === 'split' || layout === 'card') {
    renderEditorial(ctx, slide, index, totalSlides, loadedImg);
  } else {
    renderModern(ctx, slide, index, totalSlides, loadedImg);
  }

  const outputDir = path.join(__dirname, 'public', 'generated');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `slide_${Date.now()}_${index + 1}.png`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

  return `/generated/${fileName}`;
}

async function generateCarouselImages(slides = [], options = {}) {
  const safeSlides = Array.isArray(slides) ? slides : [];
  const imageUrls = [];

  for (let i = 0; i < safeSlides.length; i++) {
    imageUrls.push(await renderSlide(safeSlides[i], i, safeSlides.length, options));
  }

  return imageUrls;
}

module.exports = {
  generateCarouselImages,
  renderSlide,
  LAYOUTS,
  CANVAS_WIDTH: WIDTH,
  CANVAS_HEIGHT: HEIGHT,
  SAFE_AREA: SAFE
};
