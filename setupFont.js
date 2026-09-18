const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FONT_DIR = path.join(__dirname, 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'Pretendard-Bold.ttf');

// 404 방지를 위한 다중 CDN 미러 URL 목록
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/packages/pretendard/dist/public/static/Pretendard-Bold.otf',
  'https://fastly.jsdelivr.net/gh/orioncactus/pretendard/packages/pretendard/dist/public/static/Pretendard-Bold.otf',
  'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/Korean/NotoSansCJKkr-Bold.otf'
];

async function downloadFont() {
  if (!fs.existsSync(FONT_DIR)) {
    fs.mkdirSync(FONT_DIR, { recursive: true });
  }

  if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 100000) {
    console.log('✅ 한글 폰트(Pretendard-Bold)가 이미 정상적으로 준비되어 있습니다.');
    return;
  }

  console.log('⏳ 카드뉴스용 한글 폰트 다운로드 시작...');

  for (const url of FONT_URLS) {
    try {
      console.log(`🌐 다운로드 시도 중: ${url}`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });

      if (response.data && response.data.length > 100000) {
        fs.writeFileSync(FONT_PATH, Buffer.from(response.data));
        console.log('🎉 폰트 다운로드 및 설치 완료! 저장 경로:', FONT_PATH);
        return;
      }
    } catch (err) {
      console.warn(`⚠️ 다운로드 실패 (${err.message}), 다음 미러 서버로 재시도합니다...`);
    }
  }

  console.error('❌ 모든 폰트 미러 서버 다운로드에 실패했습니다. 기본 시스템 폰트를 유지합니다.');
}

downloadFont();