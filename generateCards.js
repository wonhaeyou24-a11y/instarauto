let createCanvas, loadImage, registerFont, GlobalFonts;
try {
  const napi = require('@napi-rs/canvas');
  createCanvas = napi.createCanvas;
  loadImage = napi.loadImage;
  GlobalFonts = napi.GlobalFonts;
} catch (_) {
  try {
    const nodeCanvas = require('canvas');
    createCanvas = nodeCanvas.createCanvas;
    loadImage = nodeCanvas.loadImage;
    registerFont = nodeCanvas.registerFont;
  } catch (canvasErr) {
    console.warn('⚠️ Canvas 모듈 로드 실패:', canvasErr.message);
  }
}

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// [1. 한글 Pretendard 폰트 자동 등록 (Zero-Crash 방어)]
const FONT_PATH = path.join(__dirname, 'fonts', 'Pretendard-Bold.ttf');
let FONT_FAMILY = 'sans-serif';

try {
  if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 100000) {
    if (GlobalFonts) {
      GlobalFonts.registerFromPath(FONT_PATH, 'Pretendard');
      FONT_FAMILY = 'Pretendard';
      console.log('✅ [Vercel/@napi-rs] Pretendard 전용 폰트가 Canvas에 정상 적용되었습니다.');
    } else if (typeof registerFont === 'function') {
      registerFont(FONT_PATH, { family: 'Pretendard' });
      FONT_FAMILY = 'Pretendard';
      console.log('✅ [node-canvas] Pretendard 전용 폰트가 Canvas에 정상 적용되었습니다.');
    }
  }
} catch (e) {
  console.warn('⚠️ 폰트 등록 예외 발생, 기본 시스템 폰트로 안전 대체합니다:', e.message);
}

const WIDTH = 1080;
const HEIGHT = 1080;
const SAFE = 96;
const CONTENT_WIDTH = WIDTH - SAFE * 2;
const BRAND_HANDLE = '@my_instastudio';

const LAYOUTS = {
  modern: {
    label: '01 모던',
    description: '배경 사진 + 강한 후킹 + 큰 제목 + 포인트 바'
  },
  editorial: {
    label: '02 에디토리얼',
    description: '매거진형 번호/제목 배치 + 다크 글래스'
  },
  split: {
    label: '03 스플릿',
    description: '좌측 컬러 패널 + 우측 배경 사진'
  },
  card: {
    label: '04 카드',
    description: '사진 배경 위 플로팅 카드 레이아웃'
  },
  minimal: {
    label: '05 미니멀',
    description: '사진과 텍스트 여백 중심의 깔끔한 구성'
  }
};

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
    lineHeightRatio = 1.3,
    maxLines = Infinity
  } = options;

  const safeText = normalizeText(text);
  if (!safeText) {
    return {
      fontSize: minFontSize,
      lineHeight: minFontSize * lineHeightRatio,
      lines: []
    };
  }

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

  return {
    fontSize: minFontSize,
    lineHeight,
    lines,
    height: lines.length * lineHeight
  };
}

function drawTextBlock(ctx, text, options = {}) {
  const {
    x,
    y,
    width,
    height,
    maxFontSize = 64,
    minFontSize = 24,
    fontWeight = '700',
    lineHeightRatio = 1.3,
    maxLines = Infinity,
    color = '#ffffff',
    align = 'left',
    vertical = 'top',
    shadow = true
  } = options;

  const fitted = fitText(ctx, text, {
    maxWidth: width,
    maxHeight: height,
    maxFontSize,
    minFontSize,
    fontWeight,
    lineHeightRatio,
    maxLines
  });

  ctx.save();
  ctx.font = `${fontWeight} ${fitted.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  if (shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  let startY = y;
  if (vertical === 'middle') {
    startY = y + Math.max(0, (height - fitted.height) / 2);
  } else if (vertical === 'bottom') {
    startY = y + Math.max(0, height - fitted.height);
  }

  for (let i = 0; i < fitted.lines.length; i++) {
    let drawX = x;
    if (align === 'center') drawX = x + width / 2;
    if (align === 'right') drawX = x + width;

    ctx.fillText(fitted.lines[i], drawX, startY + i * fitted.lineHeight);
  }
  ctx.restore();

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

// 배경 이미지 다운로드 및 Cover 비율 채우기
async function drawBackgroundImage(ctx, imageUrl) {
  if (!imageUrl) return false;
  try {
    let imgBuffer;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 6000 });
      imgBuffer = Buffer.from(response.data);
    } else {
      const localPath = path.join(__dirname, 'public', imageUrl);
      if (fs.existsSync(localPath)) {
        imgBuffer = fs.readFileSync(localPath);
      }
    }

    if (!imgBuffer) return false;
    const img = await loadImage(imgBuffer);

    const hRatio = WIDTH / img.width;
    const vRatio = HEIGHT / img.height;
    const ratio = Math.max(hRatio, vRatio);
    const centerShiftX = (WIDTH - img.width * ratio) / 2;
    const centerShiftY = (HEIGHT - img.height * ratio) / 2;

    ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);
    return true;
  } catch (err) {
    return false;
  }
}

// 배경 및 딤드 레이어 처리
async function drawBackground(ctx, layout, index, imageUrl) {
  const hasImage = await drawBackgroundImage(ctx, imageUrl);

  if (!hasImage) {
    const palettes = {
      modern: ['#0f172a', '#1e293b'],
      editorial: ['#1e293b', '#0f172a'],
      split: ['#111827', '#1f2937'],
      card: ['#1e1b4b', '#312e81'],
      minimal: ['#18181b', '#27272a']
    };
    const [a, b] = palettes[layout] || palettes.modern;
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, a);
    gradient.addColorStop(1, b);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // 딤드 오버레이
  if (layout === 'modern') {
    const overlay = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    overlay.addColorStop(0, 'rgba(15, 23, 42, 0.72)');
    overlay.addColorStop(0.5, 'rgba(15, 23, 42, 0.85)');
    overlay.addColorStop(1, 'rgba(15, 23, 42, 0.96)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (layout === 'editorial') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (layout === 'split') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (layout === 'card') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

// 상단 페이지 번호 및 하단 워터마크
function drawDecorations(ctx, index, total, isDarkBg = true) {
  // 상단 슬라이드 인디케이터
  ctx.fillStyle = isDarkBg ? '#94a3b8' : '#64748b';
  ctx.font = `700 24px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    WIDTH - SAFE,
    SAFE
  );

  // 하단 브랜드 계정 워터마크
  ctx.textAlign = 'center';
  ctx.font = `600 22px ${FONT_FAMILY}`;
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.4)';
  ctx.fillText(BRAND_HANDLE, WIDTH / 2, HEIGHT - SAFE + 25);
}

// 01 MODERN
function drawModern(ctx, slide, index, total) {
  const accent = '#f43f5e';
  drawDecorations(ctx, index, total, true);

  ctx.fillStyle = accent;
  ctx.fillRect(SAFE, 170, 150, 10);

  if (slide.type === 'cover') {
    ctx.fillStyle = accent;
    ctx.font = `800 34px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('HOT ISSUE', SAFE, 220);

    drawTextBlock(ctx, slide.title, {
      x: SAFE,
      y: 285,
      width: CONTENT_WIDTH,
      height: 350,
      maxFontSize: 80,
      minFontSize: 42,
      maxLines: 5,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE,
      y: 700,
      width: CONTENT_WIDTH,
      height: 140,
      maxFontSize: 36,
      minFontSize: 24,
      maxLines: 3,
      fontWeight: '500',
      lineHeightRatio: 1.35,
      color: '#cbd5e1'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = accent;
    ctx.font = `800 36px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`STEP ${slide.step || String(index).padStart(2, '0')}`, SAFE, 190);

    drawTextBlock(ctx, slide.title, {
      x: SAFE,
      y: 275,
      width: CONTENT_WIDTH,
      height: 250,
      maxFontSize: 66,
      minFontSize: 38,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.content, {
      x: SAFE,
      y: 575,
      width: CONTENT_WIDTH,
      height: 300,
      maxFontSize: 38,
      minFontSize: 24,
      maxLines: 7,
      fontWeight: '500',
      lineHeightRatio: 1.45,
      color: '#e2e8f0'
    });
  } else {
    ctx.fillStyle = accent;
    ctx.font = `800 32px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('SAVE THIS', WIDTH / 2, 250);

    drawTextBlock(ctx, slide.title || '저장해두고 필요할 때 꺼내보세요!', {
      x: SAFE,
      y: 330,
      width: CONTENT_WIDTH,
      height: 300,
      maxFontSize: 68,
      minFontSize: 38,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff',
      align: 'center',
      vertical: 'middle'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE,
      y: 700,
      width: CONTENT_WIDTH,
      height: 120,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '600',
      color: '#cbd5e1',
      align: 'center',
      vertical: 'middle'
    });
  }
}

// 02 EDITORIAL
function drawEditorial(ctx, slide, index, total) {
  drawDecorations(ctx, index, total, true);

  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(SAFE, 170, 8, 740);

  if (slide.type === 'cover') {
    ctx.fillStyle = '#f59e0b';
    ctx.font = `700 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('INSIGHT / FEATURE', SAFE + 44, 185);

    drawTextBlock(ctx, slide.title, {
      x: SAFE + 44,
      y: 270,
      width: CONTENT_WIDTH - 44,
      height: 350,
      maxFontSize: 74,
      minFontSize: 42,
      maxLines: 5,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE + 44,
      y: 700,
      width: CONTENT_WIDTH - 44,
      height: 140,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 3,
      fontWeight: '500',
      color: '#cbd5e1'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = '#f59e0b';
    ctx.font = `800 100px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(slide.step || String(index).padStart(2, '0'), SAFE + 44, 185);

    drawTextBlock(ctx, slide.title, {
      x: SAFE + 44,
      y: 330,
      width: CONTENT_WIDTH - 44,
      height: 220,
      maxFontSize: 62,
      minFontSize: 38,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.content, {
      x: SAFE + 44,
      y: 600,
      width: CONTENT_WIDTH - 44,
      height: 260,
      maxFontSize: 38,
      minFontSize: 24,
      maxLines: 7,
      fontWeight: '500',
      lineHeightRatio: 1.45,
      color: '#e2e8f0'
    });
  } else {
    ctx.fillStyle = '#f59e0b';
    ctx.font = `800 30px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('END NOTE', SAFE + 44, 245);

    drawTextBlock(ctx, slide.title, {
      x: SAFE + 44,
      y: 340,
      width: CONTENT_WIDTH - 44,
      height: 300,
      maxFontSize: 66,
      minFontSize: 38,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff',
      vertical: 'middle'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE + 44,
      y: 720,
      width: CONTENT_WIDTH - 44,
      height: 120,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '600',
      color: '#cbd5e1'
    });
  }
}

// 03 SPLIT
function drawSplit(ctx, slide, index, total) {
  const panelWidth = 360;
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(0, 0, panelWidth, HEIGHT);

  drawDecorations(ctx, index, total, true);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 34px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.fillText(String(index + 1).padStart(2, '0'), SAFE, 160);

  const rightX = 430;
  const rightW = WIDTH - rightX - SAFE;

  if (slide.type === 'cover') {
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 30px ${FONT_FAMILY}`;
    ctx.fillText('FEATURE', SAFE, 230);

    drawTextBlock(ctx, slide.title, {
      x: rightX,
      y: 250,
      width: rightW,
      height: 390,
      maxFontSize: 68,
      minFontSize: 38,
      maxLines: 5,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: rightX,
      y: 700,
      width: rightW,
      height: 140,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 3,
      fontWeight: '500',
      color: '#e2e8f0'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 54px ${FONT_FAMILY}`;
    ctx.fillText(slide.step || String(index).padStart(2, '0'), SAFE, 230);

    drawTextBlock(ctx, slide.title, {
      x: rightX,
      y: 245,
      width: rightW,
      height: 270,
      maxFontSize: 60,
      minFontSize: 34,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.content, {
      x: rightX,
      y: 590,
      width: rightW,
      height: 300,
      maxFontSize: 36,
      minFontSize: 22,
      maxLines: 8,
      fontWeight: '500',
      lineHeightRatio: 1.45,
      color: '#e2e8f0'
    });
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 28px ${FONT_FAMILY}`;
    ctx.fillText('SAVE', SAFE, 230);

    drawTextBlock(ctx, slide.title, {
      x: rightX,
      y: 330,
      width: rightW,
      height: 300,
      maxFontSize: 62,
      minFontSize: 36,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff',
      vertical: 'middle'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: rightX,
      y: 700,
      width: rightW,
      height: 130,
      maxFontSize: 32,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '600',
      color: '#e2e8f0'
    });
  }
}

// 04 CARD
function drawCard(ctx, slide, index, total) {
  drawDecorations(ctx, index, total, true);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  roundRect(ctx, SAFE, 150, CONTENT_WIDTH, 780, 36);
  ctx.fill();

  const innerX = SAFE + 56;
  const innerW = CONTENT_WIDTH - 112;

  if (slide.type === 'cover') {
    ctx.fillStyle = '#f97316';
    roundRect(ctx, innerX, 220, 190, 56, 28);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 26px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('TREND', innerX + 95, 236);

    drawTextBlock(ctx, slide.title, {
      x: innerX,
      y: 335,
      width: innerW,
      height: 330,
      maxFontSize: 68,
      minFontSize: 40,
      maxLines: 5,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#111827',
      shadow: false
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: innerX,
      y: 730,
      width: innerW,
      height: 130,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 3,
      fontWeight: '500',
      color: '#64748b',
      shadow: false
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = '#f97316';
    ctx.font = `800 48px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(slide.step || String(index).padStart(2, '0'), innerX, 225);

    drawTextBlock(ctx, slide.title, {
      x: innerX,
      y: 330,
      width: innerW,
      height: 230,
      maxFontSize: 58,
      minFontSize: 36,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#111827',
      shadow: false
    });

    ctx.fillStyle = '#f1f5f9';
    roundRect(ctx, innerX, 610, innerW, 230, 24);
    ctx.fill();

    drawTextBlock(ctx, slide.content, {
      x: innerX + 28,
      y: 640,
      width: innerW - 56,
      height: 170,
      maxFontSize: 34,
      minFontSize: 22,
      maxLines: 6,
      fontWeight: '500',
      lineHeightRatio: 1.45,
      color: '#334155',
      vertical: 'middle',
      shadow: false
    });
  } else {
    ctx.fillStyle = '#f97316';
    ctx.font = `800 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('SAVE & SHARE', WIDTH / 2, 245);

    drawTextBlock(ctx, slide.title, {
      x: innerX,
      y: 335,
      width: innerW,
      height: 280,
      maxFontSize: 60,
      minFontSize: 36,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#111827',
      align: 'center',
      vertical: 'middle',
      shadow: false
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: innerX,
      y: 720,
      width: innerW,
      height: 120,
      maxFontSize: 32,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '600',
      color: '#64748b',
      align: 'center',
      vertical: 'middle',
      shadow: false
    });
  }
}

// 05 MINIMAL
function drawMinimal(ctx, slide, index, total) {
  drawDecorations(ctx, index, total, true);

  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(SAFE, 190, 80, 6);

  if (slide.type === 'cover') {
    ctx.fillStyle = '#38bdf8';
    ctx.font = `600 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('INSIGHT', SAFE, 235);

    drawTextBlock(ctx, slide.title, {
      x: SAFE,
      y: 330,
      width: CONTENT_WIDTH,
      height: 360,
      maxFontSize: 74,
      minFontSize: 42,
      maxLines: 5,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE,
      y: 760,
      width: CONTENT_WIDTH,
      height: 110,
      maxFontSize: 32,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '500',
      color: '#cbd5e1'
    });
  } else if (slide.type === 'body') {
    ctx.fillStyle = '#38bdf8';
    ctx.font = `600 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`POINT ${slide.step || String(index).padStart(2, '0')}`, SAFE, 250);

    drawTextBlock(ctx, slide.title, {
      x: SAFE,
      y: 350,
      width: CONTENT_WIDTH,
      height: 240,
      maxFontSize: 62,
      minFontSize: 36,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff'
    });

    drawTextBlock(ctx, slide.content, {
      x: SAFE,
      y: 650,
      width: CONTENT_WIDTH,
      height: 220,
      maxFontSize: 36,
      minFontSize: 24,
      maxLines: 6,
      fontWeight: '500',
      lineHeightRatio: 1.45,
      color: '#e2e8f0'
    });
  } else {
    ctx.fillStyle = '#38bdf8';
    ctx.font = `800 28px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('BOOKMARK', SAFE, 245);

    drawTextBlock(ctx, slide.title, {
      x: SAFE,
      y: 350,
      width: CONTENT_WIDTH,
      height: 300,
      maxFontSize: 66,
      minFontSize: 38,
      maxLines: 4,
      fontWeight: '800',
      lineHeightRatio: 1.18,
      color: '#ffffff',
      vertical: 'middle'
    });

    drawTextBlock(ctx, slide.subtitle, {
      x: SAFE,
      y: 740,
      width: CONTENT_WIDTH,
      height: 120,
      maxFontSize: 32,
      minFontSize: 22,
      maxLines: 2,
      fontWeight: '500',
      color: '#cbd5e1'
    });
  }
}

async function createSlideCanvas(slide = {}, index, totalSlides, options = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const layout = LAYOUTS[options.layout] ? options.layout : 'modern';

  ctx.imageSmoothingEnabled = true;

  await drawBackground(ctx, layout, index, slide.imageUrl);

  if (layout === 'modern') {
    drawModern(ctx, slide, index, totalSlides);
  } else if (layout === 'editorial') {
    drawEditorial(ctx, slide, index, totalSlides);
  } else if (layout === 'split') {
    drawSplit(ctx, slide, index, totalSlides);
  } else if (layout === 'card') {
    drawCard(ctx, slide, index, totalSlides);
  } else {
    drawMinimal(ctx, slide, index, totalSlides);
  }

  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  return canvas;
}

// Vercel처럼 영구 파일시스템이 없는 환경에서도 바로 응답할 수 있는 PNG 버퍼
async function renderSlideBuffer(slide = {}, index, totalSlides, options = {}) {
  const canvas = await createSlideCanvas(slide, index, totalSlides, options);
  return canvas.toBuffer('image/png');
}

// 로컬 실행 호환용 파일 저장 렌더러
async function renderSlide(slide = {}, index, totalSlides, options = {}) {
  const canvas = await createSlideCanvas(slide, index, totalSlides, options);
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const outputDir = path.join(dataDir, 'generated');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `slide_${Date.now()}_${index + 1}.png`;
  const filePath = path.join(outputDir, fileName);

  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return `/generated/${fileName}`;
}

// 전체 카드뉴스 생성
async function generateCarouselImages(slides = [], options = {}) {
  const safeSlides = Array.isArray(slides) ? slides : [];
  const imageUrls = [];

  for (let i = 0; i < safeSlides.length; i++) {
    const url = await renderSlide(safeSlides[i], i, safeSlides.length, options);
    imageUrls.push(url);
  }

  return imageUrls;
}

module.exports = {
  generateCarouselImages,
  renderSlide,
  renderSlideBuffer,
  LAYOUTS,
  CANVAS_WIDTH: WIDTH,
  CANVAS_HEIGHT: HEIGHT,
  SAFE_AREA: SAFE
};
