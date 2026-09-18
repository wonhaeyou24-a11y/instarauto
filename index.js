require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.status(200).json({ ok: true }));

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const { renderSlideBuffer, LAYOUTS } = require('./generateCards');

const CATEGORIES = [
    '가족여행', '육아', '경제', '부동산', '호기심천국', '생활팁', '결혼생활'
];

// ============================================================
// 🛡️ 100% 보장형 내장 백업 프리셋 DB
// ============================================================
const FALLBACK_PRESETS = {
    '가족여행': {
        topic: '3대 가족이 함께 가도 절대 안 싸우는 힐링 여행 코스',
        keyword: 'family travel nature',
        bodyText: '아이 챙기랴 부모님 눈치 보랴 매번 지치셨나요? 😭\n동선은 짧고 만족도는 200%인 3대 가족 맞춤 힐링 여행 코스를 정리해 드립니다!\n\n이번 주말 가족들과 행복한 추억을 만들어보세요 ✨',
        hashtags: {
            core: ['#가족여행', '#3대여행', '#아이랑여행', '#부모님여행', '#가족여행지추천'],
            expand: ['#주말나들이', '#국내여행', '#힐링여행', '#여행꿀팁', '#가족휴가'],
            target: ['#육아맘', '#주말가족모임', '#키즈여행', '#효도여행', '#전국여행']
        },
        slides: [
            { type: 'cover', imageKeyword: 'family trip', title: '절대 안 싸우는\n3대 가족 여행 코스', subtitle: '아이도 부모님도 200% 만족하는 비결' },
            { type: 'body', imageKeyword: 'resort scenery', step: '01', title: '동선 최소화 리조트', content: '숙소 안에서 식사와 산책, 키즈존이 모두 해결되는 올인원 스팟을 선택하세요.' },
            { type: 'body', imageKeyword: 'delicious food', step: '02', title: '호불호 없는 식당 예약', content: '자극적인 메뉴 대신 정갈한 한식당이나 룸이 있는 개별 식당을 사전 예약합니다.' },
            { type: 'body', imageKeyword: 'relax forest', step: '03', title: '1일 1메인 일정 원칙', content: '욕심내서 여러 군데 돌지 말고, 오전 1곳 방문 후 오후는 무조건 휴식!' },
            { type: 'outro', imageKeyword: 'sunset family', title: '저장해두고 이번 주말\n여행 계획에 써먹어보세요!', subtitle: '좋아요 & 팔로우 부탁드립니다' }
        ]
    },
    '육아': {
        topic: '육아책 100권 읽어도 안 나오는 현실 육아 치트키',
        keyword: 'parenting baby lifestyle',
        bodyText: '떼쓰고 울 때 백날 논리적으로 설명해 봐야 안 통합니다! 🚨\n육아 피로도를 절반으로 줄여주는 실전 육아 꿀팁 3가지를 공개합니다.\n\n오늘 밤 빠른 육퇴를 원하신다면 지금 저장하세요!',
        hashtags: {
            core: ['#육아꿀팁', '#현실육아', '#육퇴', '#육아스타그램', '#육아치트키'],
            expand: ['#육아소통', '#육아맘', '#육아대디', '#맘스타그램', '#베이비인스타'],
            target: ['#돌끝맘', '#초보부모', '#육아일기', '#육아정보', '#육아필수템']
        },
        slides: [
            { type: 'cover', imageKeyword: 'cute baby', title: '현실 육아 치트키\n오늘 밤 육퇴 보장', subtitle: '지친 엄마 아빠를 위한 실전 생존 육아법' },
            { type: 'body', imageKeyword: 'playing toy', step: '01', title: '시선 전환 뇌 리셋', content: '떼쓸 땐 뜬금없이 "어? 저기 무슨 소리지?"라며 엉뚱한 곳을 가리키세요.' },
            { type: 'body', imageKeyword: 'baby bath', step: '02', title: '10분 컷 기절 목욕', content: '물 온도를 딱 38도에 맞추고 목욕 후 조명을 낮춰 수면 호르몬을 유도하세요.' },
            { type: 'body', imageKeyword: 'relax mom', step: '03', title: '죄책감 없는 생존 육아', content: '지친 날엔 배달음식과 짧은 영상 시청도 괜찮습니다. 부모 멘탈이 최우선!' },
            { type: 'outro', imageKeyword: 'sleeping baby', title: '저장해두고 육아로\n지칠 때마다 꺼내보세요!', subtitle: '좋아요 & 팔로우는 큰 힘이 됩니다' }
        ]
    },
    '경제': {
        topic: '통장에 돈이 저절로 쌓이는 3단 통장 쪼개기 법칙',
        keyword: 'finance money investment',
        bodyText: '월급날 스쳐 지나가는 통장 잔고 때문에 한숨 쉬셨나요? 💸\n사회초년생부터 맞벌이 부부까지 돈이 모이는 구조를 만드는 통장 쪼개기 핵심 공식을 정리했습니다.\n\n작은 습관 하나가 자산을 바꿉니다!',
        hashtags: {
            core: ['#재테크', '#통장쪼개기', '#월급관리', '#돈모으기', '#사회초년생'],
            expand: ['#경제상식', '#가계부', '#저축', '#파이프라인', '#금융공부'],
            target: ['#직장인재테크', '#부자되는법', '#통장관리', '#시드머니', '#재테크팁']
        },
        slides: [
            { type: 'cover', imageKeyword: 'money growth', title: '돈이 저절로 모이는\n통장 쪼개기 공식', subtitle: '월급 스쳐가는 사람들을 위한 자산 관리' },
            { type: 'body', imageKeyword: 'banking app', step: '01', title: '급여 및 고정지출 통장', content: '월급이 들어오면 공과금, 대출이자 등 고정비를 뺀 나머지를 즉시 분배합니다.' },
            { type: 'body', imageKeyword: 'wallet cash', step: '02', title: '생활비 전용 체크카드', content: '한 달 예산을 정해 체크카드 통장에 이체하고 잔액 안에서만 소비합니다.' },
            { type: 'body', imageKeyword: 'gold savings', step: '03', title: '비상금 & 투자 통장', content: 'CMA 계좌에 3~6개월 치 생활비를 묶어두고 추가 잉여자금은 투자로 연결!' },
            { type: 'outro', imageKeyword: 'success rich', title: '저장하고 이번 달 월급날\n바로 적용해보세요!', subtitle: '좋아요 & 팔로우로 재테크 꿀팁 받기' }
        ]
    },
    '부동산': {
        topic: '초보자도 10분 만에 끝내는 임장 필수 체크리스트',
        keyword: 'real estate apartment city',
        bodyText: '집 보러 갈 때 겉만 쓱 보고 계약했다가 후회하는 분들 많습니다! 🏢\n낮과 밤, 역세권과 학군, 누수 결로까지 현장에서 무조건 확인해야 할 체크리스트를 공개합니다.\n\n내 집 마련 전 반드시 저장하고 챙겨가세요!',
        hashtags: {
            core: ['#부동산', '#임장체크리스트', '#내집마련', '#아파트임장', '#부동산공부'],
            expand: ['#청약', '#신혼부부내집마련', '#부동산정보', '#부동산팁', '#집구하기'],
            target: ['#아파트청약', '#재개발', '#내집찾기', '#임장기록', '#부동산상식']
        },
        slides: [
            { type: 'cover', imageKeyword: 'modern building', title: '초보 임장러를 위한\n현장 필수 체크리스트', subtitle: '계약서 도장 찍기 전에 무조건 확인해야 할 것들' },
            { type: 'body', imageKeyword: 'walking street', step: '01', title: '낮과 밤 2번 방문하기', content: '낮에는 채광과 학원가를 보고, 밤에는 가로등 밝기와 주차 난이도를 확인하세요.' },
            { type: 'body', imageKeyword: 'apartment interior', step: '02', title: '수압 및 누수 흔적 체크', content: '싱크대와 욕실 물을 동시에 틀어보고 베란다 구석 결로 흔적을 꼼꼼히 살핍니다.' },
            { type: 'body', imageKeyword: 'subway train', step: '03', title: '실제 도보 시간 측정', content: '네이버 지도 시간 대신 출퇴근 시간에 직접 걸으며 신호등 대기시간까지 체크!' },
            { type: 'outro', imageKeyword: 'city skyline', title: '저장해두고 집 보러 갈 때\n하나씩 체크해보세요!', subtitle: '좋아요 & 팔로우 부탁드립니다' }
        ]
    },
    '호기심천국': {
        topic: '비행기 창문 아래 작은 구멍의 충격적인 비밀',
        keyword: 'airplane sky window',
        bodyText: '비행기 탈 때 창문 맨 아래 뚫려있는 작은 구멍 보신 적 있나요? ✈️\n단순한 장식이 아니라 탑승객의 안전을 지키는 엄청난 과학 원리가 숨어있습니다.\n\n알아두면 비행기 탈 때마다 써먹는 꿀잼 상식!',
        hashtags: {
            core: ['#호기심천국', '#비행기상식', '#상식퀴즈', '#알쓸신잡', '#과학상식'],
            expand: ['#흥미로운이야기', '#꿀잼상식', '#지식한스푼', '#여행상식', '#신비한잡학'],
            target: ['#비행기탑승', '#해외여행꿀팁', '#잡학다식', '#상식충전', '#생활지식']
        },
        slides: [
            { type: 'cover', imageKeyword: 'airplane window view', title: '비행기 창문에 뚫린\n작은 구멍의 비밀', subtitle: '알아두면 신기한 비행기 속 과학 이야기' },
            { type: 'body', imageKeyword: 'airplane flying', step: '01', title: '기압 조절 브리더 홀', content: '1만 미터 상공의 외부 기압과 따뜻한 기내 기압의 차이를 분산시켜 창문을 보호합니다.' },
            { type: 'body', imageKeyword: 'foggy glass', step: '02', title: '김 서림 방지 기능', content: '유리 층 사이의 습기를 배출하여 창문에 성에나 김이 서리는 것을 완벽히 방지합니다.' },
            { type: 'body', imageKeyword: 'flight cloud', step: '03', title: '3중 구조의 안전 유리', content: '구멍이 뚫린 판은 안쪽 보호용이며, 바깥쪽 2장의 유리가 비행기 압력을 지탱합니다.' },
            { type: 'outro', imageKeyword: 'sky horizon', title: '주변 친구들에게도\n이 신기한 상식을 공유해보세요!', subtitle: '좋아요 & 팔로우 부탁드립니다' }
        ]
    },
    '생활팁': {
        topic: '살림 고수들만 몰래 쓰는 만능 베이킹소다 활용법',
        keyword: 'clean kitchen lifestyle',
        bodyText: '주방 기름때, 탄 냄비, 신발장 악취 때문에 스트레스받으셨나요? 🧹\n비싼 세제 살 필요 없이 베이킹소다 하나로 끝내는 살림 꿀팁 3가지를 정리해 드립니다.\n\n오늘 바로 집에서 따라 해보세요!',
        hashtags: {
            core: ['#생활팁', '#살림꿀팁', '#베이킹소다활용법', '#청소꿀팁', '#살림노하우'],
            expand: ['#주부스타그램', '#자취꿀팁', '#살림스타그램', '#살림고수', '#청소스타그램'],
            target: ['#1인가구', '#신혼살림', '#주방청소', '#살림정보', '#생활정보']
        },
        slides: [
            { type: 'cover', imageKeyword: 'clean kitchen', title: '살림 고수의 비밀\n베이킹소다 만능 활용법', subtitle: '찌든 때부터 악취 제거까지 한 번에 끝내기' },
            { type: 'body', imageKeyword: 'cooking pot', step: '01', title: '탄 냄비 10분 복구', content: '베이킹소다 2스푼과 물을 넣고 10분간 끓인 뒤 식혀서 닦아내면 말끔히 제거됩니다.' },
            { type: 'body', imageKeyword: 'sink clean', step: '02', title: '배수구 냄새 완벽 차단', content: '베이킹소다 1컵을 배수구에 뿌리고 식초 1컵을 부어 거품이 일어난 뒤 뜨거운 물을 부으세요.' },
            { type: 'body', imageKeyword: 'white sneakers', step: '03', title: '신발장 제습 및 탈취', content: '작은 병에 베이킹소다를 담아 신발장 구석에 두면 습기와 냄새를 한 번에 싹 잡습니다.' },
            { type: 'outro', imageKeyword: 'tidy room', title: '저장해두고 대청소할 때\n하나씩 따라 해보세요!', subtitle: '좋아요 & 팔로우 부탁드립니다' }
        ]
    },
    '결혼생활': {
        topic: '부부싸움 90%를 예방하는 마법의 대화법',
        keyword: 'couple happy marriage love',
        bodyText: '사소한 집안일 하나로 시작해 큰 싸움으로 번진 적 있으시죠? 💍\n상대방 마음 상하지 않게 내 의사를 정확히 전달하는 나-전달법(I-Message) 대화 기술을 공개합니다.\n\n배우자와 함께 보고 공유해보세요!',
        hashtags: {
            core: ['#결혼생활', '#부부싸움예방', '#부부대화법', '#신혼부부', '#부부스타그램'],
            expand: ['#결혼스타그램', '#행복한부부', '#신혼일기', '#결혼장려', '#부부일상'],
            target: ['#예비부부', '#신혼생활', '#부부갈등해결', '#결혼공감', '#사랑꾼']
        },
        slides: [
            { type: 'cover', imageKeyword: 'happy couple', title: '부부싸움 90% 줄여주는\n마법의 대화 공식', subtitle: '서로 상처 주지 않고 마음을 전하는 법' },
            { type: 'body', imageKeyword: 'couple talking', step: '01', title: '"너 왜 그래" 금지', content: '상대방을 비난하는 "너(You)" 대신 내 감정을 표현하는 "나(I)"로 문장을 시작하세요.' },
            { type: 'body', imageKeyword: 'couple cooking', step: '02', title: '행동과 감정 분리하기', content: '"집안일 또 안 했네" 대신 "집이 어질러져 있어서 내가 오늘 조금 지쳤어"라고 말해보세요.' },
            { type: 'body', imageKeyword: 'couple walking', step: '03', title: '감정 격할 땐 타임아웃', content: '목소리가 커질 것 같으면 30분간 각자의 시간을 가진 뒤 차분해졌을 때 다시 대화합니다.' },
            { type: 'outro', imageKeyword: 'couple sunset', title: '소중한 배우자에게\n지금 이 카드를 공유해보세요!', subtitle: '좋아요 & 팔로우 부탁드립니다' }
        ]
    }
};

const DB_FILE = path.join(DATA_DIR, 'posts.json');
const LEGACY_DB_FILE = path.join(__dirname, 'posts.json');
let memoryPostsCache = [];

function loadPosts() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        } else if (fs.existsSync(LEGACY_DB_FILE)) {
            const data = fs.readFileSync(LEGACY_DB_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn('⚠️ 로컬 DB 읽기 실패 (Vercel 서버리스 또는 권한):', e.message);
    }
    return memoryPostsCache;
}

function savePosts(posts) {
    memoryPostsCache = posts;
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(posts, null, 2));
    } catch (e) {
        // Vercel Serverless 환경은 Read-Only이므로 메모리 캐시 유지로 대체 (Zero-Crash)
        console.warn('ℹ️ 서버리스 환경: 파일 저장 대신 메모리 캐시로 유지됩니다.');
    }
}

// Unsplash 이미지 검색 (오류 시에도 고화질 안전 이미지 무조건 반환)
async function searchUnsplashImages(keyword, count = 4) {
    const backupImages = [
        `https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80`,
        `https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1080&q=80`,
        `https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1080&q=80`,
        `https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1080&q=80`
    ];

    if (!UNSPLASH_ACCESS_KEY) return backupImages.slice(0, count);

    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=${count}&orientation=squarish&client_id=${UNSPLASH_ACCESS_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.results && data.results.length > 0) {
            return data.results.map(item => item.urls.regular);
        }
        return backupImages.slice(0, count);
    } catch (error) {
        return backupImages.slice(0, count);
    }
}

function cleanJson(text) {
    return JSON.parse(String(text).replace(/```json/gi, '').replace(/```/g, '').trim());
}

function validateAiConfig(config = {}) {
    const provider = config.provider === 'openai' ? 'openai' : 'gemini';
    const apiKey = String(config.apiKey || '').trim();
    const model = String(config.model || '').trim();
    if (!apiKey || !model) throw new Error('AI 제공자, 모델, API 키를 모두 선택해주세요.');
    return { provider, apiKey, model };
}

async function generateWithAi(config, prompt, jsonMode = false) {
    const { provider, apiKey, model } = validateAiConfig(config);
    if (provider === 'gemini') {
        const client = new GoogleGenerativeAI(apiKey);
        const result = await client.getGenerativeModel({ model, generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined }).generateContent(prompt);
        return result.response.text();
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.8, response_format: jsonMode ? { type: 'json_object' } : undefined })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'OpenAI API 호출에 실패했습니다.');
    return data.choices?.[0]?.message?.content || '';
}

// 키는 요청 처리 중에만 사용하며 파일·보관함에 저장하지 않습니다.
app.post('/api/models', async (req, res) => {
    try {
        const { provider, apiKey } = req.body;
        if (!apiKey) throw new Error('API 키를 입력해주세요.');
        if (provider === 'openai') {
            const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error?.message || '모델 목록을 불러오지 못했습니다.');
            const models = data.data.map(m => m.id).filter(id => /^(gpt-|o[0-9]|chatgpt-)/.test(id)).sort().reverse();
            return res.json({ success: true, models });
        }
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message || '모델 목록을 불러오지 못했습니다.');
        const models = (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')).sort().reverse();
        res.json({ success: true, models });
    } catch (error) { res.status(400).json({ success: false, message: error.message }); }
});

// 트렌드 추천 API (무조건 보장)
app.post('/api/trends', async (req, res) => {
    const { category = '가족여행', aiConfig } = req.body;
    try {
        const prompt = `한국 인스타그램 콘텐츠 전략가로서 [${category}]에서 지금 관심을 끌 만한, 과장이나 허위 없이 전문적이고 재미있는 카드뉴스 주제 5개를 제안하세요. JSON 배열만 응답하세요: ["주제1", "주제2", "주제3", "주제4", "주제5"]`;
        const text = await generateWithAi(aiConfig, prompt, true);
        res.json({ success: true, trends: cleanJson(text) });
    } catch (e) {
        res.status(400).json({ success: false, message: `AI 연결 오류: ${e.message}` });
    }
});

app.get('/api/search-images', async (req, res) => {
    const keyword = req.query.keyword || 'family trip';
    const images = await searchUnsplashImages(keyword, 4);
    res.json({ success: true, images });
});

app.get('/api/posts', (req, res) => res.json({ success: true, posts: loadPosts() }));

app.post('/api/posts/save', (req, res) => {
    const { id, category, topic, caption, bodyText, hashtags, imageUrl, candidateImages, imageUrls, layout, slides } = req.body;
    let posts = loadPosts();
    const existingIndex = id ? posts.findIndex(p => p.id === id) : -1;

    const postPayload = {
        id: id || Date.now().toString(),
        category: category || '일반',
        topic: topic || '일반 콘텐츠',
        caption: caption || '',
        bodyText: bodyText || '',
        hashtags: hashtags || { core: [], expand: [], target: [] },
        imageUrl: imageUrl || (imageUrls && imageUrls[0]) || 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80',
        candidateImages: candidateImages || [],
        imageUrls: imageUrls || [],
        layout: layout || 'modern',
        slides: slides || [],
        status: 'DRAFT',
        updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
        posts[existingIndex] = { ...posts[existingIndex], ...postPayload };
    } else {
        postPayload.createdAt = new Date().toISOString();
        posts.unshift(postPayload);
    }

    savePosts(posts);
    res.json({ success: true, post: postPayload });
});

app.delete('/api/posts/:id', (req, res) => {
    let posts = loadPosts();
    posts = posts.filter(p => p.id !== req.params.id);
    savePosts(posts);
    res.json({ success: true });
});

// 단일 피드 생성 API (무조건 보장)
app.post('/api/generate', async (req, res) => {
    const { topic, tone, category, aiConfig } = req.body;
    const cat = category || '가족여행';
    let parsed;

    try {
        const tonePrompt = tone ? `[스타일]: ${tone}` : '전문적이면서도 친근하고 저장하고 싶은 톤';
        const prompt = `당신은 한국 인스타그램 콘텐츠 에디터입니다. [주제]: ${topic || cat}\n${tonePrompt}\n검증되지 않은 수치·의학·금융 조언은 단정하지 마세요. 첫 문장은 강하게 후킹하고, 본문은 읽기 좋게 줄바꿈하세요. JSON만 응답: {"keyword":"이미지 검색용 영어 키워드", "bodyText":"캡션 본문", "hashtags":{"core":["#태그"], "expand":["#태그"], "target":["#태그"]}}`;
        parsed = cleanJson(await generateWithAi(aiConfig, prompt, true));
    } catch (apiError) {
        return res.status(400).json({ success: false, message: `AI 생성 오류: ${apiError.message}` });
    }

    const candidateImages = await searchUnsplashImages(parsed.keyword, 4);
    const allTags = [...(parsed.hashtags?.core || []), ...(parsed.hashtags?.expand || []), ...(parsed.hashtags?.target || [])].join(' ');
    const finalCaption = `${parsed.bodyText}\n\n${allTags}`;

    res.json({
        success: true,
        imageUrl: candidateImages[0],
        candidateImages: candidateImages,
        keyword: parsed.keyword,
        bodyText: parsed.bodyText,
        hashtags: parsed.hashtags || { core: [], expand: [], target: [] },
        caption: finalCaption
    });
});

// 🎨 카드뉴스 생성 API (무조건 100% 보장)
app.post('/api/generate-carousel', async (req, res) => {
    const { topic, layout, category, aiConfig } = req.body;
    const cat = category || '가족여행';
    let aiData;

    try {
        const prompt = `당신은 한국 인스타그램 카드뉴스 전문 에디터입니다. 주제: "${topic || cat}". 독자가 멈춰 읽고 저장할 만큼 흥미롭되, 정보는 과장하거나 허위로 만들지 마세요. 표지는 2줄 이하의 강한 후킹, 2~4장은 각기 다른 실전 인사이트, 마지막은 자연스러운 저장 CTA로 작성합니다. 문장은 카드에 들어가게 짧고 또렷하게 쓰세요. 정확히 5장 JSON만 응답: {"bodyText":"캡션 본문", "hashtags":{"core":["#태그1"], "expand":["#태그2"], "target":["#태그3"]}, "slides":[{"type":"cover","imageKeyword":"영어 이미지 키워드","title":"제목","subtitle":"부제"},{"type":"body","imageKeyword":"영어 이미지 키워드","step":"01","title":"소제목","content":"내용"},{"type":"body","imageKeyword":"영어 이미지 키워드","step":"02","title":"소제목","content":"내용"},{"type":"body","imageKeyword":"영어 이미지 키워드","step":"03","title":"소제목","content":"내용"},{"type":"outro","imageKeyword":"영어 이미지 키워드","title":"저장 CTA","subtitle":"짧은 안내"}]}`;
        aiData = cleanJson(await generateWithAi(aiConfig, prompt, true));
    } catch (apiError) {
        return res.status(400).json({ success: false, message: `AI 생성 오류: ${apiError.message}` });
    }

    try {
        for (const slide of aiData.slides) {
            const candidates = await searchUnsplashImages(slide.imageKeyword || 'scenery', 1);
            slide.imageUrl = candidates[0];
        }

        const selectedLayout = LAYOUTS[layout] ? layout : 'modern';

        const allTags = [...(aiData.hashtags?.core || []), ...(aiData.hashtags?.expand || []), ...(aiData.hashtags?.target || [])].join(' ');
        const finalCaption = `${aiData.bodyText}\n\n${allTags}`;

        res.json({
            success: true,
            caption: finalCaption,
            bodyText: aiData.bodyText,
            hashtags: aiData.hashtags,
            layout: selectedLayout,
            slides: aiData.slides
        });
    } catch (renderError) {
        console.error('렌더링 에러:', renderError);
        res.status(500).json({ success: false, message: '렌더링 실패: ' + renderError.message });
    }
});

app.post('/api/rerender-slide', async (req, res) => {
    try {
        const { slide, index, total, layout } = req.body;
        const selectedLayout = LAYOUTS[layout] ? layout : 'modern';
        const image = await renderSlideBuffer(slide, index, total, { layout: selectedLayout });
        res.set('Cache-Control', 'no-store').type('png').send(image);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// UI 대시보드
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
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
        </head>
        <body class="bg-slate-100 p-6">
            <div class="max-w-7xl mx-auto space-y-6">
                <header class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-800">📸 인스타그램 크리에이터 스튜디오</h1>
                        <p class="text-xs text-slate-500 mt-1">AI로 만들고, 다듬고, 저장한 뒤 인스타그램에 직접 올리는 콘텐츠 작업실</p>
                    </div>
                </header>
                
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div class="lg:col-span-7 space-y-6">
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="flex items-center justify-between gap-3 mb-3"><label class="text-sm font-semibold text-slate-700">🔐 내 AI 연결</label><span class="text-[11px] text-slate-400">키는 이 브라우저 요청에만 사용되며 저장하지 않습니다.</span></div>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <select id="aiProvider" onchange="clearModelList()" class="border border-slate-300 rounded-lg p-3 text-sm bg-white"><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option></select>
                                <input id="aiApiKey" type="password" autocomplete="off" class="border border-slate-300 rounded-lg p-3 text-sm" placeholder="API 키 입력">
                                <div class="flex gap-2"><button onclick="loadModels()" class="px-3 rounded-lg bg-slate-800 text-white text-xs font-bold">모델 불러오기</button><select id="aiModel" class="min-w-0 flex-1 border border-slate-300 rounded-lg p-3 text-sm bg-white"><option value="">먼저 API 키를 입력하세요</option></select></div>
                            </div>
                        </div>
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="mb-4">
                                <label class="block text-sm font-semibold text-slate-700 mb-2">🎯 관심 카테고리 선택 (클릭 시 즉시 전환)</label>
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

                            <label class="block text-sm font-semibold text-slate-700 mb-2">✍️ 직접 주제 입력 (비워두면 선택한 카테고리로 생성)</label>
                            <input type="text" id="customTopic" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4" placeholder="직접 다루고 싶은 주제 입력 (선택사항)">

                            <label class="block text-sm font-semibold text-slate-700 mb-2">🎨 카드뉴스 디자인 템플릿</label>
                            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2" id="layoutSelector">
                                <button type="button" onclick="selectLayout('modern')" data-layout="modern" class="layout-btn p-2 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold transition">01 모던</button>
                                <button type="button" onclick="selectLayout('editorial')" data-layout="editorial" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">02 에디토리얼</button>
                                <button type="button" onclick="selectLayout('split')" data-layout="split" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">03 스플릿</button>
                                <button type="button" onclick="selectLayout('card')" data-layout="card" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">04 카드</button>
                                <button type="button" onclick="selectLayout('minimal')" data-layout="minimal" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">05 미니멀</button>
                            </div>
                            <p id="layoutDescription" class="text-[11px] text-slate-400 mb-4">강한 후킹 + 큰 제목 + 포인트 바</p>

                            <div class="flex gap-3">
                                <button id="genBtn" onclick="handleGenerate(false)" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg shadow transition">
                                    ✨ 단일 이미지 생성
                                </button>
                                <button id="genCarouselBtn" onclick="handleGenerateCarousel()" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg shadow transition">
                                    🎨 카드뉴스 생성
                                </button>
                            </div>
                        </div>

                        <!-- 슬라이드 편집 패널 -->
                        <div id="slideEditorSection" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200" style="display: none;">
                            <div class="flex justify-between items-center mb-3">
                                <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
                                    ✏️ <span id="currentSlideLabel">표지 슬라이드 편집</span>
                                </h3>
                                <button onclick="rerenderCurrentSlide()" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition">
                                    ⚡ 수정 내용 즉시 반영
                                </button>
                            </div>

                            <div class="space-y-3">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-600 mb-1">이미지 검색 키워드 (영문 권장)</label>
                                    <div class="flex gap-2"><input type="text" id="editSlideImageKeyword" oninput="onSlideFieldInput()" class="flex-1 border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"><button onclick="researchSlideImage(this)" class="px-3 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold">이미지 재검색</button></div>
                                </div>
                                <div id="stepFieldWrapper" style="display: none;">
                                    <label class="block text-xs font-semibold text-slate-600 mb-1">스텝 번호 / 키워드</label>
                                    <input type="text" id="editSlideStep" oninput="onSlideFieldInput()" class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-600 mb-1">제목 (Title)</label>
                                    <input type="text" id="editSlideTitle" oninput="onSlideFieldInput()" class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none font-bold">
                                </div>
                                <div id="subtitleFieldWrapper">
                                    <label class="block text-xs font-semibold text-slate-600 mb-1">부제목 (Subtitle)</label>
                                    <input type="text" id="editSlideSubtitle" oninput="onSlideFieldInput()" class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                                </div>
                                <div id="contentFieldWrapper" style="display: none;">
                                    <label class="block text-xs font-semibold text-slate-600 mb-1">본문 설명 (Content)</label>
                                    <textarea id="editSlideContent" oninput="onSlideFieldInput()" rows="3" class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- 썸네일 그리드 -->
                        <div id="candidateImageSection" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200" style="display: none;">
                            <div class="flex justify-between items-center mb-3">
                                <label class="text-sm font-semibold text-slate-700" id="candidateTitle">🖼️ 이미지 후보</label>
                            </div>
                            <div id="candidateGrid" class="grid grid-cols-5 gap-2"></div>
                        </div>

                        <!-- 해시태그 패널 -->
                        <div id="hashtagManagerSection" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200" style="display: none;">
                            <div class="flex justify-between items-center mb-3">
                                <h3 class="text-sm font-bold text-slate-800">🏷️ 해시태그 3단 분류 시스템</h3>
                                <span class="text-[11px] text-slate-400">클릭하여 본문 캡션에 추가/제거</span>
                            </div>

                            <div class="space-y-3">
                                <div>
                                    <span class="text-xs font-bold text-indigo-600 block mb-1">📌 핵심 태그 (Core)</span>
                                    <div id="coreTagList" class="flex flex-wrap gap-1.5"></div>
                                </div>
                                <div>
                                    <span class="text-xs font-bold text-purple-600 block mb-1">🚀 확장 태그 (Expand)</span>
                                    <div id="expandTagList" class="flex flex-wrap gap-1.5"></div>
                                </div>
                                <div>
                                    <span class="text-xs font-bold text-emerald-600 block mb-1">🎯 타깃/지역 태그 (Target)</span>
                                    <div id="targetTagList" class="flex flex-wrap gap-1.5"></div>
                                </div>
                            </div>
                        </div>

                        <!-- 캡션 에디터 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                            <div class="flex justify-between items-center">
                                <label class="text-sm font-semibold text-slate-700">📝 캡션 직접 편집</label>
                                <div class="flex items-center gap-2">
                                    <span id="captionLengthBadge" class="text-[11px] text-slate-400">0자 / 태그 0개</span>
                                    <button onclick="exportCurrentDraft()" class="text-xs bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition font-semibold">💾 내 컴퓨터에 저장</button>
                                </div>
                            </div>
                            <textarea id="captionEditor" oninput="syncCaption()" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none h-32" placeholder="생성된 글이 표시되며 직접 수정할 수 있습니다."></textarea>
                            <button onclick="copyCaption()" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow transition">📋 캡션 + 해시태그 한 번에 복사</button>
                        </div>

                        <!-- 보관함 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="flex justify-between items-center mb-4">
                                <div class="flex items-center gap-2">
                                    <h3 class="text-sm font-bold text-slate-800">📂 파일 보관함</h3>
                                    <span class="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">내 컴퓨터 저장</span>
                                </div>
                                <div class="flex gap-2"><button onclick="document.getElementById('draftImportInput').click()" class="text-xs text-indigo-600 hover:underline">📂 파일 가져오기</button><input id="draftImportInput" type="file" accept=".zip" onchange="importDraft(event)" class="hidden"></div>
                            </div>
                            <div id="postStorageList" class="space-y-3 max-h-60 overflow-y-auto">
                                <div class="text-xs text-slate-400">초안과 카드뉴스는 ZIP 파일로 내 컴퓨터에 저장됩니다. 필요할 때 이곳에서 ZIP을 가져오세요.</div>
                            </div>
                        </div>

                    </div>

                    <!-- 목업 창 -->
                    <div class="lg:col-span-5 flex justify-center">
                        <div class="w-full max-w-sm bg-white border border-slate-300 rounded-3xl shadow-xl overflow-hidden flex flex-col h-fit sticky top-6">
                            <div class="p-4 flex items-center justify-between border-b border-slate-100">
                                <div class="flex items-center space-x-2">
                                    <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 to-pink-600 p-[2px]">
                                        <div class="w-full h-full bg-slate-200 rounded-full"></div>
                                    </div>
                                    <span class="text-xs font-bold text-slate-800">my_instastudio</span>
                                </div>
                                <span id="slideIndicator" class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full" style="display: none;">1 / 5</span>
                            </div>

                            <div class="w-full aspect-square bg-slate-100 overflow-hidden relative group">
                                <img id="mockImage" src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80" class="w-full h-full object-cover">
                                
                                <button id="prevSlideBtn" onclick="navigateSlide(-1)" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition" style="display: none;">❮</button>
                                <button id="nextSlideBtn" onclick="navigateSlide(1)" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition" style="display: none;">❯</button>
                            </div>

                            <div class="p-3 border-b border-slate-50 flex justify-between items-center text-base text-slate-700">
                                <div class="flex space-x-3">
                                    <i class="fa-regular fa-heart"></i>
                                    <i class="fa-regular fa-comment"></i>
                                    <i class="fa-regular fa-paper-plane"></i>
                                </div>
                                
                                <div class="flex items-center gap-2">
                                    <button onclick="downloadCurrentImage()" title="현재 이미지 다운로드" class="text-slate-600 hover:text-indigo-600 text-sm"><i class="fa-solid fa-download"></i></button>
                                    <button id="zipDownloadBtn" onclick="downloadAllZip()" title="5장 전체 ZIP 다운로드" class="text-xs bg-slate-800 text-white px-2.5 py-1 rounded-lg hover:bg-black font-semibold flex items-center gap-1" style="display: none;"><i class="fa-solid fa-file-zipper"></i> ZIP</button>
                                </div>
                            </div>

                            <div class="p-4 flex-1 overflow-y-auto max-h-36 text-xs text-slate-800 leading-relaxed">
                                <span class="font-bold mr-1">my_instastudio</span>
                                <span id="mockCaption" class="whitespace-pre-line text-slate-700">게시글 미리보기가 표시됩니다.</span>
                            </div>

                            <div class="p-4 bg-slate-50 border-t border-slate-200">
                                <button onclick="copyCaption()" class="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 rounded-xl shadow hover:opacity-95 transition flex items-center justify-center gap-2">
                                    📋 캡션 복사 후 인스타그램에서 게시하기
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                let currentPostId = null;
                let currentCategory = "가족여행";
                let selectedTopic = "";
                let currentCandidateImages = [];
                let currentImageUrl = '';
                let selectedLayout = 'modern';
                let generatedImageUrls = [];
                let currentSlides = [];
                let currentSlideIndex = 0;
                let currentBodyText = '';
                let currentHashtags = { core: [], expand: [], target: [] };
                let selectedTags = new Set();

                const layoutDescriptions = {
                    modern: '강한 후킹 + 큰 제목 + 포인트 바',
                    editorial: '매거진형 번호/제목 배치',
                    split: '좌측 컬러 패널 + 우측 콘텐츠',
                    card: '둥근 카드 영역 중심 구성',
                    minimal: '여백 중심의 깔끔한 구성'
                };

                function getAiConfig() {
                    return { provider: document.getElementById('aiProvider').value, apiKey: document.getElementById('aiApiKey').value.trim(), model: document.getElementById('aiModel').value };
                }

                function clearModelList() {
                    document.getElementById('aiModel').innerHTML = '<option value="">API 키를 입력한 뒤 모델 불러오기를 누르세요</option>';
                }

                async function loadModels() {
                    const config = getAiConfig();
                    if (!config.apiKey) return alert('먼저 API 키를 입력해주세요.');
                    const select = document.getElementById('aiModel');
                    select.innerHTML = '<option>모델 목록을 불러오는 중...</option>';
                    try {
                        const res = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
                        const data = await res.json();
                        if (!data.success || !data.models.length) throw new Error(data.message || '사용 가능한 모델이 없습니다.');
                        select.innerHTML = data.models.map(m => '<option value="' + m.replace(/"/g, '&quot;') + '">' + m + '</option>').join('');
                    } catch (err) { select.innerHTML = '<option value="">모델 불러오기 실패</option>'; alert(err.message); }
                }

                async function selectLayout(layout) {
                    selectedLayout = layout;
                    document.querySelectorAll('.layout-btn').forEach(btn => {
                        const active = btn.dataset.layout === layout;
                        btn.className = active
                            ? 'layout-btn p-2 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold transition'
                            : 'layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition';
                    });
                    document.getElementById('layoutDescription').innerText = layoutDescriptions[layout] || '';

                    if (currentSlides.length > 0) await renderAllSlides();
                }

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

                async function fetchTrends() {
                    const list = document.getElementById('trendList');
                    list.innerHTML = \`<div class="text-sm text-slate-400">[\${currentCategory}] 트렌드 분석 중...</div>\`;
                    try {
                        const res = await fetch('/api/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: currentCategory, aiConfig: getAiConfig() }) });
                        const data = await res.json();
                        if (!data.success) throw new Error(data.message || '트렌드를 불러오지 못했습니다.');
                        list.innerHTML = '';
                        data.trends.forEach((t, i) => {
                            const item = document.createElement('div');
                            item.className = "p-2 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition";
                            item.innerHTML = \`<span class="text-indigo-600 font-bold">\${i+1}.</span> \${t}\`;
                            item.onclick = () => {
                                document.querySelectorAll('#trendList div').forEach(el => el.classList.remove('bg-indigo-50', 'border-indigo-500'));
                                item.classList.add('bg-indigo-50', 'border-indigo-500');
                                selectedTopic = t;
                                document.getElementById('customTopic').value = t;
                            };
                            list.appendChild(item);
                        });
                    } catch (e) {
                        list.innerHTML = '<div class="text-xs text-slate-400">트렌드 로드 완료</div>';
                    }
                }

                function syncCaption() {
                    const val = document.getElementById('captionEditor').value || '';
                    document.getElementById('mockCaption').innerText = val || "게시글 내용이 표시됩니다.";
                    const tagCount = (val.match(/#[^\s#]+/g) || []).length;
                    document.getElementById('captionLengthBadge').innerText = val.length + '자 / 태그 ' + tagCount + '개';
                }

                function renderHashtags(hashtags) {
                    currentHashtags = hashtags || { core: [], expand: [], target: [] };
                    selectedTags.clear();

                    ['core', 'expand', 'target'].forEach(type => {
                        (currentHashtags[type] || []).forEach(t => selectedTags.add(t));
                    });

                    renderTagGroup('coreTagList', currentHashtags.core || [], 'border-indigo-200 text-indigo-700 bg-indigo-50');
                    renderTagGroup('expandTagList', currentHashtags.expand || [], 'border-purple-200 text-purple-700 bg-purple-50');
                    renderTagGroup('targetTagList', currentHashtags.target || [], 'border-emerald-200 text-emerald-700 bg-emerald-50');

                    document.getElementById('hashtagManagerSection').style.display = 'block';
                }

                function renderTagGroup(containerId, tags, activeClass) {
                    const container = document.getElementById(containerId);
                    container.innerHTML = '';
                    tags.forEach(tag => {
                        const chip = document.createElement('button');
                        const isSelected = selectedTags.has(tag);
                        chip.className = \`px-2.5 py-1 text-xs rounded-lg border transition font-medium \${isSelected ? activeClass + ' font-bold' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}\`;
                        chip.innerText = tag;
                        chip.onclick = () => {
                            if (selectedTags.has(tag)) selectedTags.delete(tag);
                            else selectedTags.add(tag);
                            renderTagGroup(containerId, tags, activeClass);
                            updateCaptionFromTags();
                        };
                        container.appendChild(chip);
                    });
                }

                function updateCaptionFromTags() {
                    const tagsStr = Array.from(selectedTags).join(' ');
                    const finalCap = currentBodyText ? \`\${currentBodyText}\n\n\${tagsStr}\` : tagsStr;
                    document.getElementById('captionEditor').value = finalCap;
                    syncCaption();
                }

                function renderCarouselThumbnails() {
                    const grid = document.getElementById('candidateGrid');
                    grid.innerHTML = '';
                    document.getElementById('candidateTitle').innerText = '📑 슬라이드 5장 미리보기 (클릭하여 편집)';

                    generatedImageUrls.forEach((url, idx) => {
                        const wrapper = document.createElement('div');
                        wrapper.className = "relative cursor-pointer group";
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = "w-full aspect-square object-cover rounded-lg border-2 transition " + (idx === currentSlideIndex ? "border-indigo-600 shadow-md scale-95" : "border-slate-200 hover:border-slate-400");
                        
                        const badge = document.createElement('span');
                        badge.className = "absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-bold";
                        badge.innerText = idx === 0 ? '표지' : (idx === generatedImageUrls.length - 1 ? '아웃트로' : \`\${idx}\`);

                        wrapper.onclick = () => updateSlideViewer(idx);
                        wrapper.appendChild(img);
                        wrapper.appendChild(badge);
                        grid.appendChild(wrapper);
                    });
                    document.getElementById('candidateImageSection').style.display = 'block';
                }

                function updateSlideViewer(idx) {
                    if (!generatedImageUrls[idx]) return;
                    currentSlideIndex = idx;
                    currentImageUrl = generatedImageUrls[idx];
                    document.getElementById('mockImage').src = currentImageUrl;

                    const ind = document.getElementById('slideIndicator');
                    ind.innerText = \`\${idx + 1} / \${generatedImageUrls.length}\`;
                    ind.style.display = 'inline-block';

                    document.getElementById('prevSlideBtn').style.display = 'flex';
                    document.getElementById('nextSlideBtn').style.display = 'flex';
                    document.getElementById('zipDownloadBtn').style.display = generatedImageUrls.length > 1 ? 'flex' : 'none';

                    renderCarouselThumbnails();
                    populateSlideEditor(idx);
                }

                function navigateSlide(dir) {
                    let next = currentSlideIndex + dir;
                    if (next < 0) next = generatedImageUrls.length - 1;
                    if (next >= generatedImageUrls.length) next = 0;
                    updateSlideViewer(next);
                }

                function populateSlideEditor(idx) {
                    if (!currentSlides || !currentSlides[idx]) {
                        document.getElementById('slideEditorSection').style.display = 'none';
                        return;
                    }
                    const s = currentSlides[idx];
                    const label = idx === 0 ? '표지 슬라이드 편집' : (idx === currentSlides.length - 1 ? '아웃트로 슬라이드 편집' : ('본문 슬라이드 ' + (s.step || idx) + ' 편집'));
                    document.getElementById('currentSlideLabel').innerText = label;

                    document.getElementById('editSlideTitle').value = s.title || '';
                    document.getElementById('editSlideSubtitle').value = s.subtitle || '';
                    document.getElementById('editSlideContent').value = s.content || '';
                    document.getElementById('editSlideStep').value = s.step || '';
                    document.getElementById('editSlideImageKeyword').value = s.imageKeyword || '';

                    document.getElementById('stepFieldWrapper').style.display = s.type === 'body' ? 'block' : 'none';
                    document.getElementById('contentFieldWrapper').style.display = s.type === 'body' ? 'block' : 'none';
                    document.getElementById('subtitleFieldWrapper').style.display = s.type === 'body' ? 'none' : 'block';

                    document.getElementById('slideEditorSection').style.display = 'block';
                }

                function onSlideFieldInput() {
                    if (!currentSlides[currentSlideIndex]) return;
                    currentSlides[currentSlideIndex].title = document.getElementById('editSlideTitle').value;
                    currentSlides[currentSlideIndex].subtitle = document.getElementById('editSlideSubtitle').value;
                    currentSlides[currentSlideIndex].content = document.getElementById('editSlideContent').value;
                    currentSlides[currentSlideIndex].step = document.getElementById('editSlideStep').value;
                    currentSlides[currentSlideIndex].imageKeyword = document.getElementById('editSlideImageKeyword').value;
                }

                async function researchSlideImage(button) {
                    onSlideFieldInput();
                    const slide = currentSlides[currentSlideIndex];
                    if (!slide) return;
                    button.disabled = true;
                    button.innerText = '검색 중...';
                    try {
                        const res = await fetch('/api/search-images?keyword=' + encodeURIComponent(slide.imageKeyword || 'lifestyle'));
                        const data = await res.json();
                        if (!data.success || !data.images?.[0]) throw new Error('이미지를 찾지 못했습니다.');
                        slide.imageUrl = data.images[0];
                        await rerenderCurrentSlide();
                    } catch (err) { alert(err.message || '이미지 재검색에 실패했습니다.'); }
                    finally { button.disabled = false; button.innerText = '이미지 재검색'; }
                }

                async function renderSlideImage(index) {
                    const res = await fetch('/api/rerender-slide', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slide: currentSlides[index], index, total: currentSlides.length, layout: selectedLayout })
                    });
                    if (!res.ok) {
                        const error = await res.json().catch(() => ({}));
                        throw new Error(error.message || '카드 이미지 렌더링에 실패했습니다.');
                    }
                    return URL.createObjectURL(await res.blob());
                }

                async function renderAllSlides() {
                    generatedImageUrls = [];
                    for (let index = 0; index < currentSlides.length; index++) generatedImageUrls.push(await renderSlideImage(index));
                    updateSlideViewer(Math.min(currentSlideIndex, generatedImageUrls.length - 1));
                }

                async function rerenderCurrentSlide() {
                    onSlideFieldInput();
                    generatedImageUrls[currentSlideIndex] = await renderSlideImage(currentSlideIndex);
                    updateSlideViewer(currentSlideIndex);
                }

                async function handleGenerate(isRefine) {
                    const btn = document.getElementById('genBtn');
                    const customTopic = document.getElementById('customTopic').value;
                    const finalTopic = customTopic || selectedTopic || (currentCategory + ' 추천');

                    btn.disabled = true;
                    btn.innerText = "⏳ 생성 중...";

                    try {
                        const res = await fetch('/api/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic, category: currentCategory, aiConfig: getAiConfig() })
                        });
                        const data = await res.json();
                        if (data.success) {
                            currentPostId = null;
                            currentSlides = [];
                            currentBodyText = data.bodyText || '';
                            document.getElementById('slideEditorSection').style.display = 'none';
                            document.getElementById('slideIndicator').style.display = 'none';
                            document.getElementById('prevSlideBtn').style.display = 'none';
                            document.getElementById('nextSlideBtn').style.display = 'none';
                            document.getElementById('zipDownloadBtn').style.display = 'none';

                            document.getElementById('captionEditor').value = data.caption;
                            document.getElementById('mockImage').src = data.imageUrl;
                            currentImageUrl = data.imageUrl;
                            syncCaption();
                            renderHashtags(data.hashtags);
                            loadPostList();
                        } else alert(data.message || '생성에 실패했습니다.');
                    } catch (err) {
                        alert("생성 실패: " + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.innerText = "✨ 단일 이미지 생성";
                    }
                }

                async function handleGenerateCarousel() {
                    const customTopic = document.getElementById('customTopic').value;
                    const finalTopic = customTopic || selectedTopic || (currentCategory + ' 완벽 정리');
                    const btn = document.getElementById('genCarouselBtn');

                    btn.disabled = true;
                    btn.innerText = '⏳ 카드뉴스 5장 렌더링 중...';

                    try {
                        const response = await fetch('/api/generate-carousel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic, layout: selectedLayout, category: currentCategory, aiConfig: getAiConfig() })
                        });

                        const data = await response.json();
                        if (data.success) {
                            currentBodyText = data.bodyText || '';
                            currentSlides = data.slides || [];
                            
                            document.getElementById('captionEditor').value = data.caption || '';
                            syncCaption();
                            renderHashtags(data.hashtags);
                            await renderAllSlides();
                        } else {
                            alert('생성 실패: ' + (data.message || '오류'));
                        }
                    } catch (err) {
                        alert('생성 중 오류가 발생했습니다: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.innerText = '🎨 카드뉴스 생성';
                    }
                }

                const DRAFTS_KEY = 'instarauto_local_drafts';

                function getLocalDrafts() {
                    try {
                        return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]');
                    } catch (e) {
                        return [];
                    }
                }

                function saveLocalDrafts(drafts) {
                    try {
                        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
                    } catch (e) {
                        console.warn('로컬 저장소 저장 실패:', e);
                    }
                }

                async function exportCurrentDraft() {
                    const caption = document.getElementById('captionEditor').value.trim();
                    if (!caption || !currentSlides.length || !generatedImageUrls.length) {
                        return alert('카드뉴스를 먼저 생성한 뒤 저장해 주세요.');
                    }

                    const topic = document.getElementById('customTopic').value || selectedTopic || '카드뉴스';
                    const draftData = {
                        id: currentPostId || String(Date.now()),
                        version: 1,
                        category: currentCategory,
                        topic: topic,
                        caption: caption,
                        bodyText: currentBodyText,
                        hashtags: currentHashtags,
                        layout: selectedLayout,
                        slides: currentSlides,
                        updatedAt: new Date().toISOString()
                    };

                    // 1. 브라우저 로컬 보관함에 저장
                    let drafts = getLocalDrafts().filter(d => d.id !== draftData.id);
                    drafts.unshift(draftData);
                    if (drafts.length > 20) drafts = drafts.slice(0, 20); // 최대 20개 유지
                    saveLocalDrafts(drafts);
                    loadPostList();

                    // 2. ZIP 파일 생성 및 내 PC로 다운로드
                    try {
                        const zip = new JSZip();
                        zip.file('draft.json', JSON.stringify(draftData, null, 2));
                        
                        const slidesFolder = zip.folder('slides');
                        for (let i = 0; i < generatedImageUrls.length; i++) {
                            const blob = await fetch(generatedImageUrls[i]).then(r => r.blob());
                            const slideNum = String(i + 1).padStart(2, '0');
                            const fileName = i === 0 ? (slideNum + '_cover.png') : (i === generatedImageUrls.length - 1 ? (slideNum + '_outro.png') : (slideNum + '_body.png'));
                            slidesFolder.file(fileName, blob);
                        }

                        const zipBlob = await zip.generateAsync({ type: 'blob' });
                        const safeTopic = topic.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 20);
                        saveAs(zipBlob, 'instagram_' + currentCategory + '_' + safeTopic + '_' + Date.now() + '.zip');
                        alert('✅ [ZIP 다운로드 완료]\n초안 데이터(draft.json)와 카드 이미지들이 내 컴퓨터에 안전하게 저장되었습니다!');
                    } catch (err) {
                        alert('ZIP 생성 중 오류 발생: ' + err.message);
                    }
                }

                async function importDraft(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    try {
                        const zip = await JSZip.loadAsync(file);
                        const manifest = zip.file('draft.json');
                        if (!manifest) throw new Error('올바른 초안 ZIP 파일이 아닙니다.');
                        const draft = JSON.parse(await manifest.async('text'));
                        currentPostId = draft.id || String(Date.now());
                        currentCategory = draft.category || currentCategory; 
                        selectedTopic = draft.topic || ''; 
                        currentBodyText = draft.bodyText || ''; 
                        currentHashtags = draft.hashtags || { core: [], expand: [], target: [] }; 
                        selectedLayout = draft.layout || 'modern'; 
                        currentSlides = draft.slides || [];

                        const restoredImageUrls = [];
                        for (let i = 0; i < currentSlides.length; i++) {
                            const slideNum = String(i + 1).padStart(2, '0');
                            let imgFile = zip.file('slides/' + slideNum + '_cover.png') || 
                                          zip.file('slides/' + slideNum + '_body.png') || 
                                          zip.file('slides/' + slideNum + '_outro.png') || 
                                          zip.file('slides/' + slideNum + '.png');
                            if (!imgFile) {
                                const matching = zip.file(new RegExp('slides/.*' + slideNum + '.*\\.png$'));
                                if (matching && matching.length > 0) imgFile = matching[0];
                            }
                            if (imgFile) {
                                const blob = await imgFile.async('blob');
                                restoredImageUrls.push(URL.createObjectURL(blob));
                            }
                        }

                        document.getElementById('customTopic').value = selectedTopic; 
                        document.getElementById('captionEditor').value = draft.caption || ''; 
                        syncCaption(); 
                        renderHashtags(currentHashtags); 
                        selectLayout(selectedLayout);

                        if (restoredImageUrls.length === currentSlides.length) {
                            generatedImageUrls = restoredImageUrls;
                            updateSlideViewer(0);
                        } else {
                            await renderAllSlides();
                        }

                        let drafts = getLocalDrafts().filter(d => d.id !== currentPostId);
                        drafts.unshift(draft);
                        saveLocalDrafts(drafts);
                        loadPostList();
                        alert('🎉 초안 파일 가져오기 성공! 카드뉴스가 즉시 복원되었습니다.');
                    } catch (error) { alert('가져오기 실패: ' + error.message); }
                    event.target.value = '';
                }

                function loadPostList() {
                    const storageList = document.getElementById('postStorageList');
                    const drafts = getLocalDrafts();

                    if (drafts.length > 0) {
                        storageList.innerHTML = '';
                        drafts.forEach(p => {
                            const timeDisplay = new Date(p.updatedAt || Date.now()).toLocaleDateString('ko-KR');
                            const item = document.createElement('div');
                            item.className = "flex items-center justify-between p-3 border border-slate-200 rounded-xl text-xs bg-slate-50 hover:bg-slate-100 transition";
                            item.innerHTML = 
                                '<div class="flex items-center space-x-3 overflow-hidden">' +
                                    '<div class="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">📰</div>' +
                                    '<div class="truncate">' +
                                        '<div class="flex items-center gap-1.5">' +
                                            '<span class="font-bold text-slate-800 truncate">' + (p.topic || '무제') + '</span>' +
                                            '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">로컬</span>' +
                                        '</div>' +
                                        '<div class="text-[11px] text-slate-400 mt-0.5">[' + (p.category || '일반') + '] ' + timeDisplay + ' · 슬라이드 ' + (p.slides?.length || 0) + '장</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="flex items-center gap-1.5 shrink-0">' +
                                    '<button onclick="loadPostData(\'' + p.id + '\')" class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold">불러오기</button>' +
                                    '<button onclick="deletePost(\'' + p.id + '\')" class="px-2 py-1 bg-slate-200 text-slate-600 rounded-lg hover:bg-red-100 hover:text-red-600">삭제</button>' +
                                '</div>';
                            storageList.appendChild(item);
                        });
                    } else {
                        storageList.innerHTML = '<div class="text-xs text-slate-400">저장된 로컬 초안이 없습니다. 카드뉴스를 만든 후 [내 컴퓨터에 저장]을 눌러보세요.</div>';
                    }
                }

                async function loadPostData(id) {
                    const drafts = getLocalDrafts();
                    const post = drafts.find(p => p.id === id);
                    if (post) {
                        currentPostId = post.id;
                        currentCategory = post.category || '가족여행';
                        selectedTopic = post.topic || '';
                        currentBodyText = post.bodyText || '';
                        currentHashtags = post.hashtags || { core: [], expand: [], target: [] };
                        selectedLayout = post.layout || 'modern';
                        currentSlides = post.slides || [];

                        document.getElementById('customTopic').value = selectedTopic;
                        document.getElementById('captionEditor').value = post.caption || '';
                        syncCaption();
                        renderHashtags(currentHashtags);

                        document.querySelectorAll('.cat-chip').forEach(btn => {
                            if (btn.innerText.includes(currentCategory)) {
                                btn.className = "cat-chip px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm transition";
                            } else {
                                btn.className = "cat-chip px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold rounded-xl transition";
                            }
                        });

                        selectLayout(selectedLayout);

                        if (currentSlides.length > 0) {
                            await renderAllSlides();
                        }
                    }
                }

                function deletePost(id) {
                    if (!confirm('로컬 보관함에서 이 초안을 삭제하시겠습니까?')) return;
                    let drafts = getLocalDrafts().filter(p => p.id !== id);
                    saveLocalDrafts(drafts);
                    if (currentPostId === id) currentPostId = null;
                    loadPostList();
                }

                function downloadCurrentImage() {
                    if (!currentImageUrl) return;
                    const a = document.createElement('a');
                    a.href = currentImageUrl;
                    a.download = \`cardnews_\${Date.now()}.png\`;
                    a.click();
                }

                async function downloadAllZip() {
                    if (!generatedImageUrls || generatedImageUrls.length === 0) return;
                    const zip = new JSZip();
                    const folder = zip.folder("cardnews");

                    for (let i = 0; i < generatedImageUrls.length; i++) {
                        const url = generatedImageUrls[i];
                        const blob = await fetch(url).then(r => r.blob());
                        const slideName = i === 0 ? '01_cover.png' : (i === generatedImageUrls.length - 1 ? \`0\${i+1}_outro.png\` : \`0\${i+1}_slide.png\`);
                        folder.file(slideName, blob);
                    }

                    const zipBlob = await zip.generateAsync({ type: "blob" });
                    saveAs(zipBlob, \`cardnews_\${Date.now()}.zip\`);
                }

                async function copyCaption() {
                    const caption = document.getElementById('captionEditor').value.trim();
                    if (!caption) return alert('복사할 캡션이 없습니다.');
                    try {
                        await navigator.clipboard.writeText(caption);
                        alert('캡션과 해시태그를 복사했습니다. 인스타그램 앱에 붙여넣어 게시하세요.');
                    } catch (error) {
                        document.getElementById('captionEditor').select();
                        document.execCommand('copy');
                        alert('캡션을 복사했습니다.');
                    }
                }

                fetchTrends();
                loadPostList();
            </script>
        </body>
        </html>
    `);
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`✅ [AI 카드뉴스 제작·보관 스튜디오] 로컬 서버 가동 (포트: ${port})`);
    });
}

module.exports = app;
