require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const { generateCarouselImages } = require('./generateCards');
const { publishInstagramCarousel } = require('./instagramCarousel');

// [고정 관심 카테고리 목록]
const CATEGORIES = [
    '가족여행', '육아', '경제', '부동산', '호기심천국', '생활팁', '결혼생활'
];

// [로컬 파일 기반 콘텐츠 보관함 DB 설정]
const DB_FILE = path.join(__dirname, 'posts.json');

function loadPosts() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function savePosts(posts) {
    fs.writeFileSync(DB_FILE, JSON.stringify(posts, null, 2));
}

// [상태 관리] 자동화 모드 및 로그
let autoPilotState = {
    enabled: false,
    interval: '6hours',
    logs: []
};
let scheduledTask = null;

function addLog(message) {
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    const entry = `[${timestamp}] ${message}`;
    autoPilotState.logs.unshift(entry);
    if (autoPilotState.logs.length > 50) autoPilotState.logs.pop();
    console.log(entry);
}

// [Unsplash 이미지 다중 검색 모듈 (4개 후보)]
async function searchUnsplashImages(keyword, count = 4) {
    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=${count}&orientation=squarish&client_id=${UNSPLASH_ACCESS_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.results && data.results.length > 0) {
            return data.results.map(item => item.urls.regular);
        }
        throw new Error("No images found");
    } catch (error) {
        return [
            `https://placehold.co/600x600/1e293b/ffffff?text=${encodeURIComponent(keyword)}+1`,
            `https://placehold.co/600x600/334155/ffffff?text=${encodeURIComponent(keyword)}+2`,
            `https://placehold.co/600x600/475569/ffffff?text=${encodeURIComponent(keyword)}+3`,
            `https://placehold.co/600x600/64748b/ffffff?text=${encodeURIComponent(keyword)}+4`
        ];
    }
}

// [무인 자동 생성 파이프라인]
async function runAutoPilotPipeline() {
    // 7개 카테고리 중 무작위 선택
    const randomCategory = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    addLog(`🤖 [자동화] 카테고리 [${randomCategory}] 기반 콘텐츠 자동 생성을 시작합니다...`);

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const prompt = `
        너는 10만 팔로워를 가진 트렌디한 인스타그램 마케터야.
        선택된 카테고리: [${randomCategory}]
        
        이 카테고리에서 20~40대 독자들의 시선을 사로잡고 저장/공유하고 싶게 만드는 매력적인 인스타그램 캡션과 Unsplash 검색용 영어 단어 1개를 작성해줘.

        조건:
        1. 첫 문장은 시선을 사로잡는 강력한 후킹으로 시작
        2. 이모지와 깔끔한 줄바꿈 사용
        3. 해시태그 5개 포함
        4. 순수 JSON 형식으로만 응답:
        {
            "topic": "구체적인 주제명",
            "keyword": "검색용 영어단어",
            "caption": "인스타그램 본문 전체"
        }
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        addLog(`🎯 주제 선정 완료: [${parsed.topic}]`);
        const candidateImages = await searchUnsplashImages(parsed.keyword, 4);
        const selectedImg = candidateImages[0];
        
        const posts = loadPosts();
        const newPost = {
            id: Date.now().toString(),
            category: randomCategory,
            topic: parsed.topic,
            title: parsed.topic,
            caption: parsed.caption,
            imageUrl: selectedImg,
            candidateImages: candidateImages,
            status: 'DRAFT',
            createdAt: new Date().toISOString()
        };
        posts.unshift(newPost);
        savePosts(posts);

        addLog(`📸 콘텐츠 생성 및 임시저장(DRAFT) 완료!`);
    } catch (error) {
        addLog(`❌ 자동화 실행 중 오류 발생: ${error.message}`);
    }
}

function setupCron(interval) {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
    let cronTime = '0 */6 * * *';
    if (interval === '1min') cronTime = '*/1 * * * *';
    if (interval === '1hour') cronTime = '0 */1 * * *';
    if (interval === '24hours') cronTime = '0 9 * * *';

    scheduledTask = cron.schedule(cronTime, () => {
        if (autoPilotState.enabled) {
            runAutoPilotPipeline();
        }
    });
}

// [API 라우트]
app.get('/api/autopilot', (req, res) => {
    res.json(autoPilotState);
});

app.post('/api/autopilot/toggle', (req, res) => {
    const { enabled, interval } = req.body;
    autoPilotState.enabled = enabled;
    if (interval) autoPilotState.interval = interval;
    
    if (enabled) {
        setupCron(autoPilotState.interval);
        addLog(`🟢 완전 자동화 가동 시작 (주기: ${autoPilotState.interval})`);
        runAutoPilotPipeline();
    } else {
        if (scheduledTask) scheduledTask.stop();
        addLog(`🔴 완전 자동화가 일시 중지되었습니다.`);
    }
    res.json({ success: true, state: autoPilotState });
});

// 카테고리별 맞춤 트렌드 추천 API
app.get('/api/trends', async (req, res) => {
    const category = req.query.category || '가족여행';
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const prompt = `인스타그램에서 인기 있는 [${category}] 관련 트렌디하고 후킹력 강한 주제 5개를 추천해줘. 순수 JSON 배열 형식으로만 응답: ["주제1", "주제2", "주제3", "주제4", "주제5"]`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json({ success: true, trends: JSON.parse(text) });
    } catch (e) {
        const fallbacks = {
            '가족여행': ["아이와 함께 가기 좋은 가성비 계곡 스팟", "주말 1박 2일 힐링 가족 리조트 추천", "아이랑 사진 찍기 좋은 국내 숨은 명소", "부모님 모시고 가기 딱 좋은 힐링 코스", "비 오는 날 실내 아이 놀거리 BEST 5"],
            '육아': ["현실 육아 스트레스 줄여주는 꿀템 5가지", "아이 감정 조절 도와주는 마법의 대화법", "자기 전 10분 아이와 유대감 쌓는 놀이", "등원 준비 시간 반으로 줄이는 팁", "어린이집/유치원 적응 완벽 가이드"],
            '경제': ["사회초년생도 바로 따라하는 월급 관리 루틴", "신용점수 50점 바로 올리는 꿀팁", "모르면 손해보는 정부 숨은 지원금 찾기", "통장 쪼개기로 1년에 1000만원 모으기", "주린이를 위한 필수 경제 용어 정리"],
            '부동산': ["첫 내 집 마련 전 반드시 체크할 5가지", "보증금 안전하게 지키는 전월세 계약 팁", "청약 가점 낮아도 당첨되는 전략", "부동산 임장 갈 때 필수로 챙길 체크리스트", "소자본 공간대여/에어비앤비 시작 가이드"],
            '호기심천국': ["비행기 창문 아래 작은 구멍의 충격적인 비밀", "바나나는 왜 굽어 있을까? 신기한 이유", "잠들기 직전 몸이 덜컹 떨어지는 느낌의 정체", "인간의 뇌가 매일 거짓말하는 3가지 순간", "세상에서 가장 비싼 액체 TOP 3"],
            '생활팁': ["옷에 묻은 얼룩 종류별 완벽 제거법", "싱크대 배수구 악취 5분 만에 없애기", "남은 배달 음식 갓 만든 것처럼 데우는 법", "다이소에서 안 사면 손해인 살림 꿀템", "아이폰/갤럭시 숨겨진 200% 활용 꿀기능"],
            '결혼생활': ["부부싸움 칼로 물 베기로 끝내는 3원칙", "맞벌이 부부 가사분담 평화롭게 정리하는 법", "양가 부모님 선물 센스있게 고르는 팁", "결혼 5년 차가 말하는 진짜 현실 조언", "주말 부부 데이트 추천 코스 & 대화법"]
        };
        res.json({ success: true, trends: fallbacks[category] || fallbacks['가족여행'] });
    }
});

// 이미지 직접 키워드 검색 API
app.get('/api/search-images', async (req, res) => {
    const keyword = req.query.keyword || 'family trip';
    const images = await searchUnsplashImages(keyword, 4);
    res.json({ success: true, images });
});

// 콘텐츠 보관함 API
app.get('/api/posts', (req, res) => {
    const posts = loadPosts();
    res.json({ success: true, posts });
});

app.post('/api/posts/save', (req, res) => {
    const { category, topic, caption, imageUrl, candidateImages, status } = req.body;
    const posts = loadPosts();
    const newPost = {
        id: Date.now().toString(),
        category: category || '일반',
        topic: topic || '일반 콘텐츠',
        caption,
        imageUrl,
        candidateImages: candidateImages || [],
        status: status || 'DRAFT',
        createdAt: new Date().toISOString()
    };
    posts.unshift(newPost);
    savePosts(posts);
    res.json({ success: true, post: newPost });
});

app.delete('/api/posts/:id', (req, res) => {
    let posts = loadPosts();
    posts = posts.filter(p => p.id !== req.params.id);
    savePosts(posts);
    res.json({ success: true });
});

// AI 콘텐츠 생성 및 이미지 후보 추출 API
app.post('/api/generate', async (req, res) => {
    const { topic, instruction, currentCaption, tone } = req.body;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        let tonePrompt = tone ? `[스타일/톤]: ${tone} 분위기로 변환해줘.` : '';
        let prompt = currentCaption
            ? `[기존]: ${currentCaption}\n[지시]: ${instruction}\n${tonePrompt}\n수정 후 JSON 응답: {"keyword":"검색용 영어단어", "caption":"수정본"}`
            : `[주제]: ${topic}\n[지시]: ${instruction || "없음"}\n${tonePrompt}\n조건: 첫문장 강력한 후킹, 이모지, 해시태그 5개 포함\nJSON 응답: {"keyword":"검색용 영어단어", "caption":"본문"}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        const candidateImages = await searchUnsplashImages(parsed.keyword, 4);

        res.json({ 
            success: true, 
            imageUrl: candidateImages[0], 
            candidateImages: candidateImages,
            keyword: parsed.keyword,
            caption: parsed.caption 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// [카드뉴스 생성 API]
app.post('/api/generate-carousel', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) {
      return res.status(400).json({ success: false, message: '주제를 입력해주세요.' });
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
주제: "${topic}"
인스타그램 캐러셀(카드뉴스) 형식으로 콘텐츠를 작성해줘.
슬라이드는 표지 1개, 본문 3~4개, 마지막 아웃트로 1개 총 5개 내외로 구성해줘.
반드시 아래 JSON 구조로만 응답해:

{
  "caption": "인스타그램 본문 캡션 및 해시태그",
  "slides": [
    { "type": "cover", "title": "메인 후킹 제목", "subtitle": "부제목" },
    { "type": "body", "step": "01", "title": "소제목 1", "content": "본문 핵심 설명 (2~3줄)" },
    { "type": "body", "step": "02", "title": "소제목 2", "content": "본문 핵심 설명 (2~3줄)" },
    { "type": "body", "step": "03", "title": "소제목 3", "content": "본문 핵심 설명 (2~3줄)" },
    { "type": "outro", "title": "저장해두고 필요할 때 꺼내보세요!", "subtitle": "좋아요 & 팔로우 부탁드립니다" }
  ]
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const aiData = JSON.parse(responseText);

    const imageUrls = await generateCarouselImages(aiData.slides);

    const posts = loadPosts();
    posts.unshift({
        id: Date.now().toString(),
        topic: topic,
        caption: aiData.caption,
        imageUrl: imageUrls[0],
        imageUrls: imageUrls,
        status: 'DRAFT',
        createdAt: new Date().toISOString()
    });
    savePosts(posts);

    res.json({
      success: true,
      caption: aiData.caption,
      imageUrls: imageUrls
    });

  } catch (err) {
    console.error('캐러셀 생성 중 오류 발생:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// [UI 대시보드]
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>인스타그램 스튜디오</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        </head>
        <body class="bg-slate-100 p-6">
            <div class="max-w-7xl mx-auto space-y-6">
                <!-- 상단 헤더 & 완전자동화 컨트롤러 -->
                <header class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-800">📸 인스타그램 크리에이터 스튜디오</h1>
                        <p class="text-xs text-slate-500 mt-1">7대 핵심 카테고리 타깃 맞춤형 콘텐츠 제작 시스템</p>
                    </div>

                    <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div class="flex flex-col">
                            <span class="text-xs font-bold text-slate-700">⚡ 완전 무인 자동화 (Auto-Pilot)</span>
                            <select id="autoInterval" class="text-xs border border-slate-300 rounded mt-1 p-1 bg-white">
                                <option value="1min">테스트 (1분 주기)</option>
                                <option value="1hour">1시간마다 자동 발행</option>
                                <option value="6hours" selected>6시간마다 자동 발행</option>
                                <option value="24hours">매일 오전 9시 발행</option>
                            </select>
                        </div>
                        <button id="autoToggleBtn" onclick="toggleAutoPilot()" class="px-5 py-2.5 rounded-lg font-bold text-sm bg-slate-300 text-slate-700 transition">
                            자동화 OFF
                        </button>
                    </div>
                </header>
                
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <!-- 제어창 (좌측 7열) -->
                    <div class="lg:col-span-7 space-y-6">
                        <!-- 수동 지시 & 기획 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <!-- 7대 관심 카테고리 선택 칩 -->
                            <div class="mb-4">
                                <label class="block text-sm font-semibold text-slate-700 mb-2">🎯 관심 카테고리 선택</label>
                                <div class="flex flex-wrap gap-2" id="categoryChips">
                                    <button onclick="selectCategory('가족여행')" class="cat-chip px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm transition">🏖️ 가족여행</button>
                                    <button onclick="selectCategory('육아')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">🍼 육아</button>
                                    <button onclick="selectCategory('경제')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">📈 경제</button>
                                    <button onclick="selectCategory('부동산')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">🏢 부동산</button>
                                    <button onclick="selectCategory('호기심천국')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">💡 호기심천국</button>
                                    <button onclick="selectCategory('생활팁')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">🧹 생활팁</button>
                                    <button onclick="selectCategory('결혼생활')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition">💍 결혼생활</button>
                                </div>
                            </div>

                            <div class="flex justify-between items-center mb-3">
                                <label class="text-sm font-semibold text-slate-700">🔥 추천 트렌드 주제</label>
                                <button onclick="fetchTrends()" class="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
                            </div>
                            <div id="trendList" class="space-y-2 mb-4">
                                <div class="text-sm text-slate-400">트렌드를 불러오는 중...</div>
                            </div>

                            <label class="block text-sm font-semibold text-slate-700 mb-2">✍️ 직접 주제 입력</label>
                            <input type="text" id="customTopic" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4" placeholder="직접 다루고 싶은 주제 입력">

                            <!-- AI 톤앤매너 빠른 선택 버튼 -->
                            <label class="block text-sm font-semibold text-slate-700 mb-2">✨ AI 톤앤매너 스타일 선택</label>
                            <div class="flex flex-wrap gap-2 mb-4">
                                <button onclick="setTone('🔥 후킹 강화')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">🔥 후킹 강화</button>
                                <button onclick="setTone('😊 더 친근하게')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">😊 친근하게</button>
                                <button onclick="setTone('💰 마케팅형')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">💰 마케팅형</button>
                                <button onclick="setTone('🎯 전문가 스타일')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">🎯 전문가</button>
                                <button onclick="setTone('✂️ 짧고 임팩트있게')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">✂️ 짧게</button>
                            </div>
                            <input type="hidden" id="selectedTone" value="">

                            <label class="block text-sm font-semibold text-slate-700 mb-2">💡 상세 지시 및 수정 요구사항</label>
                            <textarea id="instruction" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4" rows="2" placeholder="예: '첫 문장을 더 자극적으로', '해시태그를 더 다양하게'"></textarea>

                            <div class="flex gap-3">
                                <button id="genBtn" onclick="handleGenerate(false)" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg shadow transition">
                                    ✨ 단일 이미지 생성
                                </button>
                                <button id="genCarouselBtn" onclick="handleGenerateCarousel()" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg shadow transition">
                                    🎨 카드뉴스 생성
                                </button>
                                <button id="refineBtn" onclick="handleGenerate(true)" class="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 rounded-lg shadow transition">
                                    🔄 재작성
                                </button>
                            </div>
                        </div>

                        <!-- 이미지 후보 선택기 -->
                        <div id="candidateImageSection" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200" style="display: none;">
                            <div class="flex justify-between items-center mb-3">
                                <label class="text-sm font-semibold text-slate-700">🖼️ 이미지 후보 선택 (클릭하여 적용)</label>
                                <div class="flex items-center gap-2">
                                    <input type="text" id="manualImageKeyword" placeholder="새 키워드 검색" class="border border-slate-300 rounded p-1 text-xs">
                                    <button onclick="searchImagesManual()" class="text-xs bg-slate-800 text-white px-2 py-1 rounded">검색</button>
                                </div>
                            </div>
                            <div id="candidateGrid" class="grid grid-cols-4 gap-3">
                                <!-- 4개 이미지 후보가 렌더링됩니다 -->
                            </div>
                        </div>

                        <!-- 캡션 에디터 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="flex justify-between items-center mb-2">
                                <label class="text-sm font-semibold text-slate-700">📝 캡션 직접 편집</label>
                                <button onclick="saveCurrentDraft()" class="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 transition">💾 현재 내용 임시저장</button>
                            </div>
                            <textarea id="captionEditor" oninput="syncCaption()" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none h-36" placeholder="생성된 글이 표시되며 직접 수정할 수 있습니다."></textarea>
                        </div>

                        <!-- 콘텐츠 보관함 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-sm font-bold text-slate-800">📚 콘텐츠 보관함 (임시저장 & 이력)</h3>
                                <button onclick="loadPostList()" class="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
                            </div>
                            <div id="postStorageList" class="space-y-3 max-h-60 overflow-y-auto">
                                <div class="text-xs text-slate-400">저장된 콘텐츠를 불러오는 중...</div>
                            </div>
                        </div>

                        <!-- 자동화 로그 모니터링 창 -->
                        <div class="bg-slate-900 text-emerald-400 p-4 rounded-2xl shadow-sm font-mono text-xs h-32 overflow-y-auto" id="logConsole">
                            <div>> [시스템 준비 완료] 대시보드 구동 중...</div>
                        </div>
                    </div>

                    <!-- 모바일 목업 (우측 5열) -->
                    <div class="lg:col-span-5 flex justify-center">
                        <div class="w-full max-w-sm bg-white border border-slate-300 rounded-3xl shadow-xl overflow-hidden flex flex-col h-fit sticky top-6">
                            <div class="p-4 flex items-center justify-between border-b border-slate-100">
                                <div class="flex items-center space-x-2">
                                    <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 to-pink-600 p-[2px]">
                                        <div class="w-full h-full bg-slate-200 rounded-full"></div>
                                    </div>
                                    <span class="text-xs font-bold text-slate-800">my_instastudio</span>
                                </div>
                                <i class="fa-solid fa-ellipsis text-slate-500 text-xs"></i>
                            </div>

                            <div class="w-full aspect-square bg-slate-100 overflow-hidden">
                                <img id="mockImage" src="https://placehold.co/600x600/f1f5f9/94a3b8?text=Image+Preview" class="w-full h-full object-cover">
                            </div>

                            <div class="p-3 border-b border-slate-50 flex justify-between items-center text-base text-slate-700">
                                <div class="flex space-x-3">
                                    <i class="fa-regular fa-heart"></i>
                                    <i class="fa-regular fa-comment"></i>
                                    <i class="fa-regular fa-paper-plane"></i>
                                </div>
                                <i class="fa-regular fa-bookmark"></i>
                            </div>

                            <div class="p-4 flex-1 overflow-y-auto max-h-48 text-xs text-slate-800 leading-relaxed">
                                <span class="font-bold mr-1">my_instastudio</span>
                                <span id="mockCaption" class="whitespace-pre-line text-slate-700">게시글 미리보기가 표시됩니다.</span>
                            </div>

                            <div class="p-4 bg-slate-50 border-t border-slate-200">
                                <button onclick="alert('인스타그램 실제 발행은 토큰 연동 후 진행됩니다.')" class="w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white font-bold py-3 rounded-xl shadow hover:opacity-95 transition">
                                    🚀 인스타그램에 바로 게시
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                let currentCategory = "가족여행";
                let selectedTopic = "";
                let isAutoEnabled = false;
                let currentCandidateImages = [];
                let currentImageUrl = '';

                function selectCategory(cat) {
                    currentCategory = cat;
                    document.querySelectorAll('.cat-chip').forEach(btn => {
                        if (btn.innerText.includes(cat)) {
                            btn.className = "cat-chip px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm transition";
                        } else {
                            btn.className = "cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition";
                        }
                    });
                    fetchTrends();
                }

                function setTone(toneName) {
                    document.querySelectorAll('.tone-btn').forEach(btn => btn.classList.remove('bg-indigo-100', 'border-indigo-500', 'text-indigo-700'));
                    event.target.classList.add('bg-indigo-100', 'border-indigo-500', 'text-indigo-700');
                    document.getElementById('selectedTone').value = toneName;
                }

                async function fetchTrends() {
                    const list = document.getElementById('trendList');
                    list.innerHTML = \`<div class="text-sm text-slate-400">[\${currentCategory}] 트렌드 분석 중...</div>\`;
                    try {
                        const res = await fetch(\`/api/trends?category=\${encodeURIComponent(currentCategory)}\`);
                        const data = await res.json();
                        list.innerHTML = '';
                        data.trends.forEach((t, i) => {
                            const item = document.createElement('div');
                            item.className = "p-2 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition";
                            item.innerHTML = \`<span class="text-indigo-600 font-bold">\${i+1}.</span> \${t}\`;
                            item.onclick = () => {
                                document.querySelectorAll('#trendList div').forEach(el => el.classList.remove('bg-indigo-50', 'border-indigo-500'));
                                item.classList.add('bg-indigo-50', 'border-indigo-500');
                                selectedTopic = t;
                                document.getElementById('customTopic').value = '';
                            };
                            list.appendChild(item);
                        });
                    } catch (e) {
                        list.innerHTML = '<div class="text-xs text-red-400">로드 실패</div>';
                    }
                }

                function syncCaption() {
                    document.getElementById('mockCaption').innerText = document.getElementById('captionEditor').value || "게시글 내용이 표시됩니다.";
                }

                function renderCandidates(images) {
                    currentCandidateImages = images;
                    const grid = document.getElementById('candidateGrid');
                    grid.innerHTML = '';
                    images.forEach((url, idx) => {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = "w-full aspect-square object-cover rounded-lg cursor-pointer border-2 hover:border-indigo-600 transition " + (url === currentImageUrl ? "border-indigo-600 scale-95" : "border-transparent");
                        img.onclick = () => {
                            currentImageUrl = url;
                            document.getElementById('mockImage').src = url;
                            renderCandidates(currentCandidateImages);
                        };
                        grid.appendChild(img);
                    });
                    document.getElementById('candidateImageSection').style.display = 'block';
                }

                async function searchImagesManual() {
                    const kw = document.getElementById('manualImageKeyword').value;
                    if (!kw) return;
                    const res = await fetch(\`/api/search-images?keyword=\${encodeURIComponent(kw)}\`);
                    const data = await res.json();
                    if (data.success && data.images.length > 0) {
                        currentImageUrl = data.images[0];
                        document.getElementById('mockImage').src = currentImageUrl;
                        renderCandidates(data.images);
                    }
                }

                async function handleGenerate(isRefine) {
                    const btn = isRefine ? document.getElementById('refineBtn') : document.getElementById('genBtn');
                    const customTopic = document.getElementById('customTopic').value;
                    const finalTopic = customTopic || selectedTopic || \`\${currentCategory} 트렌드 인사이트\`;
                    const instruction = document.getElementById('instruction').value;
                    const currentCaption = isRefine ? document.getElementById('captionEditor').value : "";
                    const tone = document.getElementById('selectedTone').value;

                    btn.disabled = true;
                    btn.innerText = "⏳ 처리 중...";

                    try {
                        const res = await fetch('/api/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic, instruction, currentCaption, tone })
                        });
                        const data = await res.json();
                        if (data.success) {
                            document.getElementById('captionEditor').value = data.caption;
                            document.getElementById('mockCaption').innerText = data.caption;
                            document.getElementById('mockImage').src = data.imageUrl;
                            currentImageUrl = data.imageUrl;
                            renderCandidates(data.candidateImages);
                            loadPostList();
                        }
                    } catch (err) {
                        alert("생성 실패");
                    } finally {
                        btn.disabled = false;
                        btn.innerText = isRefine ? "🔄 재작성" : "✨ 단일 이미지 생성";
                    }
                }

                async function handleGenerateCarousel() {
                    const customTopic = document.getElementById('customTopic').value;
                    const finalTopic = customTopic || selectedTopic || \`\${currentCategory} 트렌드 인사이트\`;
                    const btn = document.getElementById('genCarouselBtn');

                    btn.disabled = true;
                    btn.innerText = "⏳ 카드뉴스 생성 중...";

                    try {
                        const response = await fetch('/api/generate-carousel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic })
                        });

                        const data = await response.json();
                        if (data.success) {
                            generatedImageUrls = data.imageUrls;
                            generatedCaption = data.caption;
                            currentImageUrl = generatedImageUrls[0];

                            document.getElementById('captionEditor').value = generatedCaption;
                            document.getElementById('mockCaption').innerText = generatedCaption;
                            document.getElementById('mockImage').src = currentImageUrl;
                            loadPostList();
                        } else {
                            alert('생성 실패: ' + data.message);
                        }
                    } catch (err) {
                        console.error(err);
                        alert('서버 통신 중 오류가 발생했습니다.');
                    } finally {
                        btn.disabled = false;
                        btn.innerText = "🎨 카드뉴스 생성";
                    }
                }

                async function saveCurrentDraft() {
                    const caption = document.getElementById('captionEditor').value;
                    if (!caption) {
                        alert('저장할 내용이 없습니다.');
                        return;
                    }
                    await fetch('/api/posts/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            category: currentCategory,
                            topic: selectedTopic || document.getElementById('customTopic').value || '수동 작성글', 
                            caption, 
                            imageUrl: currentImageUrl || 'https://placehold.co/600x600', 
                            candidateImages: currentCandidateImages,
                            status: 'DRAFT' 
                        })
                    });
                    alert('성공적으로 임시저장되었습니다.');
                    loadPostList();
                }

                async function loadPostList() {
                    const storageList = document.getElementById('postStorageList');
                    try {
                        const res = await fetch('/api/posts');
                        const data = await res.json();
                        if (data.success && data.posts.length > 0) {
                            storageList.innerHTML = '';
                            data.posts.forEach(p => {
                                const dateStr = new Date(p.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                const item = document.createElement('div');
                                item.className = "flex items-center justify-between p-3 border border-slate-200 rounded-xl text-xs bg-slate-50 hover:bg-white transition";
                                item.innerHTML = \`
                                    <div class="flex items-center space-x-3 overflow-hidden">
                                        <img src="\${p.imageUrl}" class="w-10 h-10 object-cover rounded-lg shrink-0">
                                        <div class="truncate">
                                            <span class="font-bold text-slate-800 block truncate">\${p.topic}</span>
                                            <span class="text-slate-400 text-[10px]">[\${p.category || '일반'}] \${dateStr} · <span class="text-indigo-600 font-semibold">\${p.status}</span></span>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2 shrink-0">
                                        <button onclick="loadPostData('\${p.id}')" class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">불러오기</button>
                                        <button onclick="deletePost('\${p.id}')" class="px-2 py-1 bg-slate-200 text-slate-600 rounded-lg hover:bg-red-100 hover:text-red-600">삭제</button>
                                    </div>
                                \`;
                                storageList.appendChild(item);
                            });
                        } else {
                            storageList.innerHTML = '<div class="text-xs text-slate-400">저장된 콘텐츠가 없습니다.</div>';
                        }
                    } catch (e) {
                        storageList.innerHTML = '<div class="text-xs text-red-400">보관함 로드 실패</div>';
                    }
                }

                async function loadPostData(id) {
                    const res = await fetch('/api/posts');
                    const data = await res.json();
                    const post = data.posts.find(p => p.id === id);
                    if (post) {
                        document.getElementById('captionEditor').value = post.caption;
                        document.getElementById('mockCaption').innerText = post.caption;
                        document.getElementById('mockImage').src = post.imageUrl;
                        currentImageUrl = post.imageUrl;
                        if (post.candidateImages && post.candidateImages.length > 0) {
                            renderCandidates(post.candidateImages);
                        }
                    }
                }

                async function deletePost(id) {
                    if (!confirm('정말 삭제하시겠습니까?')) return;
                    await fetch(\`/api/posts/\${id}\`, { method: 'DELETE' });
                    loadPostList();
                }

                async function toggleAutoPilot() {
                    const interval = document.getElementById('autoInterval').value;
                    isAutoEnabled = !isAutoEnabled;
                    const res = await fetch('/api/autopilot/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: isAutoEnabled, interval })
                    });
                    const data = await res.json();
                    updateAutoUI(data.state);
                }

                function updateAutoUI(state) {
                    const btn = document.getElementById('autoToggleBtn');
                    if (state.enabled) {
                        btn.className = "px-5 py-2.5 rounded-lg font-bold text-sm bg-emerald-500 text-white shadow-md animate-pulse";
                        btn.innerText = "자동화 ON 🟢";
                    } else {
                        btn.className = "px-5 py-2.5 rounded-lg font-bold text-sm bg-slate-300 text-slate-700 transition";
                        btn.innerText = "자동화 OFF 🔴";
                    }
                    const logConsole = document.getElementById('logConsole');
                    logConsole.innerHTML = state.logs.map(l => \`<div>> \${l}</div>\`).join('');
                }

                setInterval(async () => {
                    const res = await fetch('/api/autopilot');
                    const data = await res.json();
                    updateAutoUI(data);
                }, 3000);

                fetchTrends();
                loadPostList();
            </script>
        </body>
        </html>
    `);
});

app.listen(port, () => {
    console.log(`✅ [7대 카테고리 타깃형] 대시보드 서버 가동 (포트: ${port})`);
});
