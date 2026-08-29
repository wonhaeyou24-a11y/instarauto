require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const IG_USER_ID = (process.env.IG_USER_ID || '').trim();
const IG_ACCESS_TOKEN = (process.env.IG_ACCESS_TOKEN || '').trim();

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const { generateCarouselImages, renderSlide, LAYOUTS } = require('./generateCards');
const { publishInstagramSingle, publishInstagramCarousel } = require('./instagramCarousel');

// [고정 관심 카테고리]
const CATEGORIES = [
    '가족여행', '육아', '경제', '부동산', '호기심천국', '생활팁', '결혼생활'
];

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

let autoPilotState = {
    enabled: false,
    interval: '6hours',
    autoSchedule: true,
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

// 🔔 카카오톡 알림
let kakaoAccessToken = null;
async function getKakaoAccessToken() {
    const REST_API_KEY = process.env.KAKAO_CLIENT_ID;
    const REFRESH_TOKEN = process.env.KAKAO_REFRESH_TOKEN;
    if (!REST_API_KEY || !REFRESH_TOKEN) return null;

    try {
        const res = await axios.post('https://kauth.kakao.com/oauth/token', null, {
            params: {
                grant_type: 'refresh_token',
                client_id: REST_API_KEY,
                refresh_token: REFRESH_TOKEN
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        kakaoAccessToken = res.data.access_token;
        return kakaoAccessToken;
    } catch (err) {
        return null;
    }
}

async function sendKakaoNotification(title, message, linkUrl = 'http://localhost:3000') {
    const token = await getKakaoAccessToken();
    if (!token) return;

    try {
        const template = {
            object_type: 'text',
            text: `[인스타 스튜디오 알림]\n\n📌 ${title}\n${message}`,
            link: { web_url: linkUrl, mobile_web_url: linkUrl },
            button_title: '게시물 확인'
        };

        await axios.post(
            'https://kapi.kakao.com/v2/api/talk/memo/default/send',
            `template_object=${encodeURIComponent(JSON.stringify(template))}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        addLog('💬 카카오톡 알림 전송 완료');
    } catch (err) {}
}

// 품질 검사 및 중복 검사
const FORBIDDEN_WORDS = ['100% 보장', '무조건 수익', '불법', '성인', '마약', '대출상담', '비밀리크'];
function inspectContentQuality(parsed) {
    const fullText = `${parsed.topic} ${parsed.bodyText}`;
    for (const word of FORBIDDEN_WORDS) {
        if (fullText.includes(word)) return { passed: false, reason: `금칙어: [${word}]` };
    }
    if (!parsed.bodyText || parsed.bodyText.length < 30) return { passed: false, reason: '본문 30자 미만' };
    return { passed: true };
}

function checkDuplicateTopic(newTopic) {
    const posts = loadPosts();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentPosts = posts.filter(p => new Date(p.createdAt).getTime() > thirtyDaysAgo);
    return recentPosts.some(p => p.topic && (p.topic.includes(newTopic) || newTopic.includes(p.topic)));
}

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

function getGeminiModel(generationConfig) {
    if (!GEMINI_API_KEY) throw new Error('Gemini API 키가 없습니다.');
    return genAI.getGenerativeModel({ model: GEMINI_MODEL, generationConfig });
}

function getGeminiErrorMessage(error) {
    return error?.message || String(error);
}

// 공개 절대 URL 변환 유틸
function toAbsoluteUrl(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
    return `${baseUrl}${url}`;
}

// 황금 피드 예약 시간 계산 (오전 9시, 낮 12시, 오후 7시)
function getNextOptimalScheduleTime() {
    const now = new Date();
    const optimalHours = [9, 12, 19];
    
    for (let h of optimalHours) {
        let candidate = new Date(now);
        candidate.setHours(h, 0, 0, 0);
        if (candidate > now) {
            return candidate.toISOString();
        }
    }
    
    let tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
}

// [실제 Instagram 게시 공통 실행 함수]
async function executePublishPost(post) {
    if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
        throw new Error('.env에 IG_USER_ID 및 IG_ACCESS_TOKEN이 필요합니다.');
    }

    let publishResult;
    if (Array.isArray(post.imageUrls) && post.imageUrls.length > 1) {
        const absoluteUrls = post.imageUrls.map(url => toAbsoluteUrl(url));
        publishResult = await publishInstagramCarousel(absoluteUrls, post.caption, IG_USER_ID, IG_ACCESS_TOKEN);
    } else {
        const targetImg = post.imageUrl || (post.imageUrls && post.imageUrls[0]);
        const absoluteUrl = toAbsoluteUrl(targetImg);
        publishResult = await publishInstagramSingle(absoluteUrl, post.caption, IG_USER_ID, IG_ACCESS_TOKEN);
    }
    return publishResult;
}

// ⏰ [예약 발행 감시 스케줄러 - 매 분 실행]
cron.schedule('* * * * *', async () => {
    const posts = loadPosts();
    const now = new Date();
    let updated = false;

    for (let post of posts) {
        if (post.status === 'SCHEDULED' && post.scheduledAt) {
            const scheduledTime = new Date(post.scheduledAt);
            if (scheduledTime <= now) {
                addLog(`⏰ [예약 시간 도달] [${post.topic}] 게시물 자동 발행을 시작합니다...`);
                try {
                    const publishResult = await executePublishPost(post);
                    post.status = 'PUBLISHED';
                    post.instagramPostId = publishResult.postId;
                    post.publishedAt = now.toISOString();
                    updated = true;
                    addLog(`🎉 [예약 자동발행 성공] Post ID: ${publishResult.postId}`);
                    await sendKakaoNotification(
                        '예약 콘텐츠 자동 발행 완료 🚀',
                        `주제: ${post.topic}\n게시물 ID: ${publishResult.postId}\n링크: ${publishResult.postUrl}`,
                        publishResult.postUrl
                    );
                } catch (err) {
                    addLog(`❌ [예약 자동발행 실패] ${err.message}`);
                    post.status = 'FAILED';
                    post.lastError = err.message;
                    updated = true;
                }
            }
        }
    }

    if (updated) {
        savePosts(posts);
    }
});

// 🔄 Auto-Pilot 무인 파이프라인
async function runAutoPilotPipeline(retryCount = 0) {
    const MAX_RETRIES = 3;
    const randomCategory = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    addLog(`🤖 [자동화] 카테고리 [${randomCategory}] 자동 생성 가동 (${retryCount + 1}/${MAX_RETRIES})`);

    try {
        const model = getGeminiModel();
        const prompt = `
        너는 10만 팔로워를 가진 트렌디한 인스타그램 마케터야.
        선택된 카테고리: [${randomCategory}]
        첫 문장은 강력한 후킹, 이모지와 줄바꿈 적용.
        JSON 응답:
        {
            "topic": "주제명",
            "keyword": "검색용 영어단어",
            "bodyText": "해시태그 제외한 본문 전체",
            "hashtags": {
                "core": ["#핵심1", "#핵심2", "#핵심3", "#핵심4", "#핵심5"],
                "expand": ["#확장1", "#확장2", "#확장3", "#확장4", "#확장5"],
                "target": ["#타깃1", "#타깃2", "#타깃3", "#타깃4", "#타깃5"]
            }
        }
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        if (checkDuplicateTopic(parsed.topic)) throw new Error('중복 주제 감지');
        const inspection = inspectContentQuality(parsed);
        if (!inspection.passed) throw new Error(inspection.reason);

        const candidateImages = await searchUnsplashImages(parsed.keyword, 4);
        const selectedImg = candidateImages[0];
        
        const allTags = [...(parsed.hashtags?.core || []), ...(parsed.hashtags?.expand || []), ...(parsed.hashtags?.target || [])].join(' ');
        const finalCaption = `${parsed.bodyText}\n\n${allTags}`;

        const scheduledTime = autoPilotState.autoSchedule ? getNextOptimalScheduleTime() : null;
        const targetStatus = autoPilotState.autoSchedule ? 'SCHEDULED' : 'DRAFT';

        const posts = loadPosts();
        const newPost = {
            id: Date.now().toString(),
            category: randomCategory,
            topic: parsed.topic,
            title: parsed.topic,
            caption: finalCaption,
            bodyText: parsed.bodyText,
            hashtags: parsed.hashtags,
            imageUrl: selectedImg,
            candidateImages: candidateImages,
            imageUrls: [selectedImg],
            layout: 'modern',
            slides: [],
            status: targetStatus,
            scheduledAt: scheduledTime,
            publishedAt: null,
            createdAt: new Date().toISOString()
        };
        posts.unshift(newPost);
        savePosts(posts);

        if (targetStatus === 'SCHEDULED') {
            const dateStr = new Date(scheduledTime).toLocaleString('ko-KR');
            addLog(`⏰ [자동 예약] 콘텐츠가 황금 시간대(${dateStr})로 예약 등록되었습니다.`);
            await sendKakaoNotification('신규 콘텐츠 자동 예약 완료 ⏰', `주제: ${parsed.topic}\n예약시간: ${dateStr}`);
        } else {
            addLog(`💾 [보관함 저장] 콘텐츠가 임시저장(DRAFT) 상태로 저장되었습니다.`);
            await sendKakaoNotification('신규 콘텐츠 자동 생성 완료 ✅', `주제: ${parsed.topic}\n상태: DRAFT`);
        }

    } catch (error) {
        addLog(`❌ 파이프라인 오류: ${error.message}`);
        if (retryCount < MAX_RETRIES - 1) {
            const delayTime = Math.pow(2, retryCount) * 3000;
            setTimeout(() => runAutoPilotPipeline(retryCount + 1), delayTime);
        } else {
            await sendKakaoNotification('자동화 실행 실패 🚨', `사유: ${error.message}`);
        }
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
        if (autoPilotState.enabled) runAutoPilotPipeline();
    });
}

// [API 라우트]
app.get('/api/autopilot', (req, res) => res.json(autoPilotState));

app.post('/api/autopilot/toggle', (req, res) => {
    const { enabled, interval, autoSchedule } = req.body;
    autoPilotState.enabled = enabled;
    if (interval) autoPilotState.interval = interval;
    if (autoSchedule !== undefined) autoPilotState.autoSchedule = autoSchedule;
    
    if (enabled) {
        setupCron(autoPilotState.interval);
        addLog(`🟢 완전 자동화 가동 (주기: ${autoPilotState.interval} / 자동예약: ${autoPilotState.autoSchedule ? 'ON' : 'OFF'})`);
        runAutoPilotPipeline();
    } else {
        if (scheduledTask) scheduledTask.stop();
        addLog(`🔴 완전 자동화 일시 중지`);
    }
    res.json({ success: true, state: autoPilotState });
});

app.get('/api/trends', async (req, res) => {
    const category = req.query.category || '가족여행';
    try {
        const model = getGeminiModel();
        const prompt = `인스타그램 인기 [${category}] 후킹 주제 5개 JSON 배열 응답: ["주제1", "주제2", "주제3", "주제4", "주제5"]`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json({ success: true, trends: JSON.parse(text) });
    } catch (e) {
        res.json({ success: true, trends: ["가족과 함께 떠나는 힐링 스팟", "주말 추천 코스", "알아두면 유용한 실전 팁"] });
    }
});

app.get('/api/search-images', async (req, res) => {
    const keyword = req.query.keyword || 'family trip';
    const images = await searchUnsplashImages(keyword, 4);
    res.json({ success: true, images });
});

app.get('/api/posts', (req, res) => res.json({ success: true, posts: loadPosts() }));

app.post('/api/posts/save', (req, res) => {
    const { id, category, topic, caption, bodyText, hashtags, imageUrl, candidateImages, imageUrls, layout, slides, status, scheduledAt } = req.body;
    let posts = loadPosts();
    const existingIndex = id ? posts.findIndex(p => p.id === id) : -1;
    
    const postPayload = {
        id: id || Date.now().toString(),
        category: category || '일반',
        topic: topic || '일반 콘텐츠',
        caption: caption || '',
        bodyText: bodyText || '',
        hashtags: hashtags || { core: [], expand: [], target: [] },
        imageUrl: imageUrl || (imageUrls && imageUrls[0]) || 'https://placehold.co/600x600',
        candidateImages: candidateImages || [],
        imageUrls: imageUrls || [],
        layout: layout || 'modern',
        slides: slides || [],
        status: status || 'DRAFT',
        scheduledAt: scheduledAt !== undefined ? scheduledAt : (existingIndex !== -1 ? posts[existingIndex].scheduledAt : null),
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

app.post('/api/posts/status', (req, res) => {
    const { id, status } = req.body;
    let posts = loadPosts();
    posts = posts.map(p => {
        if (p.id === id) {
            p.status = status;
            if (status === 'DRAFT') p.scheduledAt = null;
        }
        return p;
    });
    savePosts(posts);
    res.json({ success: true, posts });
});

app.delete('/api/posts/:id', (req, res) => {
    let posts = loadPosts();
    posts = posts.filter(p => p.id !== req.params.id);
    savePosts(posts);
    res.json({ success: true });
});

app.post('/api/generate', async (req, res) => {
    const { topic, instruction, currentCaption, tone } = req.body;
    try {
        const model = getGeminiModel();
        let tonePrompt = tone ? `[스타일/톤]: ${tone} 분위기로 변환해줘.` : '';
        let prompt = currentCaption
            ? `[기존 글]: ${currentCaption}\n[지시사항]: ${instruction}\n${tonePrompt}\nJSON 형식 응답:
            {
              "keyword": "검색용 영어단어",
              "bodyText": "해시태그 제외한 본문",
              "hashtags": { "core": ["#태그1"], "expand": ["#태그2"], "target": ["#태그3"] }
            }`
            : `[주제]: ${topic}\n[지시사항]: ${instruction || "없음"}\n${tonePrompt}\nJSON 형식 응답:
            {
              "keyword": "검색용 영어단어",
              "bodyText": "해시태그 제외한 본문",
              "hashtags": { "core": ["#태그1"], "expand": ["#태그2"], "target": ["#태그3"] }
            }`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
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
    } catch (error) {
        res.status(500).json({ success: false, message: getGeminiErrorMessage(error) });
    }
});

app.post('/api/generate-carousel', async (req, res) => {
  try {
    const { topic, layout } = req.body;
    if (!topic) return res.status(400).json({ success: false, message: '주제를 입력해주세요.' });

    const model = getGeminiModel({ responseMimeType: 'application/json' });
    const prompt = `
주제: "${topic}"
인스타그램 캐러셀 형식 콘텐츠 작성. 슬라이드는 표지 1개, 본문 3개, 아웃트로 1개 총 5개.
각 슬라이드마다 imageKeyword 영어단어 1개 포함.
JSON 응답:
{
  "bodyText": "본문 설명글",
  "hashtags": { "core": ["#태그1"], "expand": ["#태그2"], "target": ["#태그3"] },
  "slides": [
    { "type": "cover", "imageKeyword": "family trip", "title": "제목", "subtitle": "부제목" },
    { "type": "body", "imageKeyword": "scenery", "step": "01", "title": "소제목 1", "content": "내용" },
    { "type": "body", "imageKeyword": "hotel", "step": "02", "title": "소제목 2", "content": "내용" },
    { "type": "body", "imageKeyword": "food", "step": "03", "title": "소제목 3", "content": "내용" },
    { "type": "outro", "imageKeyword": "sunset", "title": "저장하세요", "subtitle": "좋아요" }
  ]
}
`;

    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    for (const slide of aiData.slides) {
      const candidates = await searchUnsplashImages(slide.imageKeyword || 'lifestyle', 1);
      slide.imageUrl = candidates[0];
    }

    const selectedLayout = LAYOUTS[layout] ? layout : 'modern';
    const imageUrls = await generateCarouselImages(aiData.slides, { layout: selectedLayout });

    const allTags = [...(aiData.hashtags?.core || []), ...(aiData.hashtags?.expand || []), ...(aiData.hashtags?.target || [])].join(' ');
    const finalCaption = `${aiData.bodyText}\n\n${allTags}`;

    const newId = Date.now().toString();
    const posts = loadPosts();
    posts.unshift({
        id: newId,
        topic: topic,
        caption: finalCaption,
        bodyText: aiData.bodyText,
        hashtags: aiData.hashtags,
        imageUrl: imageUrls[0],
        imageUrls: imageUrls,
        layout: selectedLayout,
        slides: aiData.slides,
        status: 'DRAFT',
        createdAt: new Date().toISOString()
    });
    savePosts(posts);

    res.json({
      success: true,
      id: newId,
      caption: finalCaption,
      bodyText: aiData.bodyText,
      hashtags: aiData.hashtags,
      imageUrls: imageUrls,
      layout: selectedLayout,
      slides: aiData.slides
    });

  } catch (err) {
    res.status(500).json({ success: false, message: getGeminiErrorMessage(err) });
  }
});

app.post('/api/rerender-slide', async (req, res) => {
    try {
        const { slide, index, total, layout } = req.body;
        const selectedLayout = LAYOUTS[layout] ? layout : 'modern';
        const imageUrl = await renderSlide(slide, index, total, { layout: selectedLayout });
        res.json({ success: true, imageUrl });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/rerender-all', async (req, res) => {
    try {
        const { slides, layout } = req.body;
        const selectedLayout = LAYOUTS[layout] ? layout : 'modern';
        const imageUrls = await generateCarouselImages(slides, { layout: selectedLayout });
        res.json({ success: true, imageUrls });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 즉시 발행 API
app.post('/api/publish-now', async (req, res) => {
    const { postId, imageUrls, imageUrl, caption } = req.body;
    try {
        addLog(`🚀 [인스타그램 즉시 발행 시도] 게시물 처리를 시작합니다...`);
        const postObj = { imageUrls, imageUrl, caption };
        const publishResult = await executePublishPost(postObj);

        if (postId) {
            let posts = loadPosts();
            const idx = posts.findIndex(p => p.id === postId);
            if (idx !== -1) {
                posts[idx].status = 'PUBLISHED';
                posts[idx].instagramPostId = publishResult.postId;
                posts[idx].publishedAt = new Date().toISOString();
                savePosts(posts);
            }
        }

        addLog(`🎉 [인스타그램 발행 성공] Post ID: ${publishResult.postId}`);
        await sendKakaoNotification(
            '인스타그램 피드 발행 성공 🚀',
            `게시물 ID: ${publishResult.postId}\n인스타 링크: ${publishResult.postUrl}`,
            publishResult.postUrl
        );

        res.json({ success: true, ...publishResult });
    } catch (error) {
        addLog(`❌ [발행 실패] ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
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
                        <p class="text-xs text-slate-500 mt-1">완전자동화 Auto-Pilot & 스마트 예약 큐 시스템</p>
                    </div>

                    <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div class="flex flex-col">
                            <span class="text-xs font-bold text-slate-700">⚡ 완전 무인 자동화 (Auto-Pilot)</span>
                            <div class="flex items-center gap-2 mt-1">
                                <select id="autoInterval" class="text-xs border border-slate-300 rounded p-1 bg-white">
                                    <option value="1min">테스트 (1분 주기)</option>
                                    <option value="1hour">1시간마다 실행</option>
                                    <option value="6hours" selected>6시간마다 실행</option>
                                    <option value="24hours">매일 오전 9시</option>
                                </select>
                                <label class="text-[11px] text-slate-600 flex items-center gap-1 cursor-pointer">
                                    <input type="checkbox" id="autoScheduleCheck" checked class="rounded text-indigo-600"> 자동 예약큐 등록
                                </label>
                            </div>
                        </div>
                        <button id="autoToggleBtn" onclick="toggleAutoPilot()" class="px-5 py-2.5 rounded-lg font-bold text-sm bg-slate-300 text-slate-700 transition">
                            자동화 OFF
                        </button>
                    </div>
                </header>
                
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div class="lg:col-span-7 space-y-6">
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
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

                            <label class="block text-sm font-semibold text-slate-700 mb-2">✨ AI 톤앤매너 스타일 선택</label>
                            <div class="flex flex-wrap gap-2 mb-4">
                                <button onclick="setTone('🔥 후킹 강화')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">🔥 후킹 강화</button>
                                <button onclick="setTone('😊 더 친근하게')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">😊 친근하게</button>
                                <button onclick="setTone('💰 마케팅형')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">💰 마케팅형</button>
                                <button onclick="setTone('🎯 전문가 스타일')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">🎯 전문가</button>
                                <button onclick="setTone('✂️ 짧고 임팩트있게')" class="tone-btn px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-xs font-semibold rounded-lg border border-slate-200 transition">✂️ 짧게</button>
                            </div>
                            <input type="hidden" id="selectedTone" value="">

                            <label class="block text-sm font-semibold text-slate-700 mb-2">🎨 카드뉴스 디자인 템플릿</label>
                            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2" id="layoutSelector">
                                <button type="button" onclick="selectLayout('modern')" data-layout="modern" class="layout-btn p-2 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold transition">01 모던</button>
                                <button type="button" onclick="selectLayout('editorial')" data-layout="editorial" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">02 에디토리얼</button>
                                <button type="button" onclick="selectLayout('split')" data-layout="split" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">03 스플릿</button>
                                <button type="button" onclick="selectLayout('card')" data-layout="card" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">04 카드</button>
                                <button type="button" onclick="selectLayout('minimal')" data-layout="minimal" class="layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition">05 미니멀</button>
                            </div>
                            <p id="layoutDescription" class="text-[11px] text-slate-400 mb-4">강한 후킹 + 큰 제목 + 포인트 바</p>

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

                        <!-- 이미지 썸네일 그리드 -->
                        <div id="candidateImageSection" class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200" style="display: none;">
                            <div class="flex justify-between items-center mb-3">
                                <label class="text-sm font-semibold text-slate-700" id="candidateTitle">🖼️ 이미지 후보 선택</label>
                                <div class="flex items-center gap-2" id="manualSearchBox">
                                    <input type="text" id="manualImageKeyword" placeholder="새 키워드 검색" class="border border-slate-300 rounded p-1 text-xs">
                                    <button onclick="searchImagesManual()" class="text-xs bg-slate-800 text-white px-2 py-1 rounded">검색</button>
                                </div>
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

                        <!-- 캡션 에디터 & 예약 설정 바 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                            <div class="flex justify-between items-center">
                                <label class="text-sm font-semibold text-slate-700">📝 캡션 직접 편집</label>
                                <div class="flex items-center gap-2">
                                    <span id="captionLengthBadge" class="text-[11px] text-slate-400">0자 / 태그 0개</span>
                                    <button onclick="saveCurrentDraft()" class="text-xs bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition font-semibold">💾 임시저장</button>
                                </div>
                            </div>
                            <textarea id="captionEditor" oninput="syncCaption()" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none h-32" placeholder="생성된 글이 표시되며 직접 수정할 수 있습니다."></textarea>
                            
                            <!-- 예약 일시 지정 바 -->
                            <div class="p-4 bg-indigo-50/60 rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3">
                                <div class="flex items-center gap-2">
                                    <i class="fa-regular fa-calendar-check text-indigo-600"></i>
                                    <span class="text-xs font-bold text-indigo-900">예약 일시 설정:</span>
                                    <input type="datetime-local" id="scheduleInput" class="text-xs border border-indigo-200 rounded-lg p-1.5 bg-white text-slate-700">
                                </div>
                                <button onclick="scheduleCurrentPost()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow transition">
                                    📅 이 시간에 예약 발행 등록
                                </button>
                            </div>
                        </div>

                        <!-- 보관함 및 예약 큐 목록 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <div class="flex justify-between items-center mb-4">
                                <div class="flex items-center gap-2">
                                    <h3 class="text-sm font-bold text-slate-800">📋 콘텐츠 보관 및 예약 대기열</h3>
                                    <span id="queueBadge" class="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">0건</span>
                                </div>
                                <button onclick="loadPostList()" class="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
                            </div>
                            <div id="postStorageList" class="space-y-3 max-h-60 overflow-y-auto">
                                <div class="text-xs text-slate-400">저장된 콘텐츠를 불러오는 중...</div>
                            </div>
                        </div>

                        <!-- 로그 콘솔 -->
                        <div class="bg-slate-900 text-emerald-400 p-4 rounded-2xl shadow-sm font-mono text-xs h-28 overflow-y-auto" id="logConsole">
                            <div>> [시스템 준비 완료] 대시보드 구동 중...</div>
                        </div>
                    </div>

                    <!-- 모바일 목업 & 실제 발행 버튼 -->
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
                                <img id="mockImage" src="https://placehold.co/600x600/f1f5f9/94a3b8?text=Image+Preview" class="w-full h-full object-cover">
                                
                                <button id="prevSlideBtn" onclick="navigateSlide(-1)" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition" style="display: none;">
                                    ❮
                                </button>
                                <button id="nextSlideBtn" onclick="navigateSlide(1)" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition" style="display: none;">
                                    ❯
                                </button>
                            </div>

                            <div class="p-3 border-b border-slate-50 flex justify-between items-center text-base text-slate-700">
                                <div class="flex space-x-3">
                                    <i class="fa-regular fa-heart"></i>
                                    <i class="fa-regular fa-comment"></i>
                                    <i class="fa-regular fa-paper-plane"></i>
                                </div>
                                
                                <div class="flex items-center gap-2">
                                    <button onclick="downloadCurrentImage()" title="현재 이미지 다운로드" class="text-slate-600 hover:text-indigo-600 text-sm">
                                        <i class="fa-solid fa-download"></i>
                                    </button>
                                    <button id="zipDownloadBtn" onclick="downloadAllZip()" title="5장 전체 ZIP 다운로드" class="text-xs bg-slate-800 text-white px-2.5 py-1 rounded-lg hover:bg-black font-semibold flex items-center gap-1" style="display: none;">
                                        <i class="fa-solid fa-file-zipper"></i> ZIP
                                    </button>
                                </div>
                            </div>

                            <div class="p-4 flex-1 overflow-y-auto max-h-36 text-xs text-slate-800 leading-relaxed">
                                <span class="font-bold mr-1">my_instastudio</span>
                                <span id="mockCaption" class="whitespace-pre-line text-slate-700">게시글 미리보기가 표시됩니다.</span>
                            </div>

                            <!-- STEP 4 실제 발행 버튼 -->
                            <div class="p-4 bg-slate-50 border-t border-slate-200">
                                <button id="publishNowBtn" onclick="publishDirectToInstagram()" class="w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white font-bold py-3 rounded-xl shadow hover:opacity-95 transition flex items-center justify-center gap-2">
                                    🚀 인스타그램에 실제 바로 게시
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
                let isAutoEnabled = false;
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

                window.addEventListener('DOMContentLoaded', () => {
                    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
                    nextHour.setMinutes(0);
                    const localISO = new Date(nextHour.getTime() - (nextHour.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                    document.getElementById('scheduleInput').value = localISO;
                });

                async function selectLayout(layout) {
                    selectedLayout = layout;
                    document.querySelectorAll('.layout-btn').forEach(btn => {
                        const active = btn.dataset.layout === layout;
                        btn.className = active
                            ? 'layout-btn p-2 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold transition'
                            : 'layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition';
                    });
                    document.getElementById('layoutDescription').innerText = layoutDescriptions[layout] || '';

                    if (currentSlides.length > 0) {
                        const res = await fetch('/api/rerender-all', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ slides: currentSlides, layout: selectedLayout })
                        });
                        const data = await res.json();
                        if (data.success) {
                            generatedImageUrls = data.imageUrls;
                            updateSlideViewer(currentSlideIndex);
                        }
                    }
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
                    const val = document.getElementById('captionEditor').value || '';
                    document.getElementById('mockCaption').innerText = val || "게시글 내용이 표시됩니다.";
                    const tagCount = (val.match(/#[^\s#]+/g) || []).length;
                    document.getElementById('captionLengthBadge').innerText = \`\${val.length}자 / 태그 \${tagCount}개\`;
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
                    document.getElementById('manualSearchBox').style.display = 'none';

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
                    const label = idx === 0 ? '표지 슬라이드 편집' : (idx === currentSlides.length - 1 ? '아웃트로 슬라이드 편집' : \`본문 슬라이드 \${s.step || idx} 편집\`);
                    document.getElementById('currentSlideLabel').innerText = label;

                    document.getElementById('editSlideTitle').value = s.title || '';
                    document.getElementById('editSlideSubtitle').value = s.subtitle || '';
                    document.getElementById('editSlideContent').value = s.content || '';
                    document.getElementById('editSlideStep').value = s.step || '';

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
                }

                async function rerenderCurrentSlide() {
                    onSlideFieldInput();
                    const slide = currentSlides[currentSlideIndex];
                    const res = await fetch('/api/rerender-slide', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            slide,
                            index: currentSlideIndex,
                            total: currentSlides.length,
                            layout: selectedLayout
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        generatedImageUrls[currentSlideIndex] = data.imageUrl;
                        updateSlideViewer(currentSlideIndex);
                    }
                }

                function renderCandidates(images) {
                    currentCandidateImages = images;
                    const grid = document.getElementById('candidateGrid');
                    grid.innerHTML = '';
                    document.getElementById('candidateTitle').innerText = '🖼️ 이미지 후보 선택 (클릭하여 적용)';
                    document.getElementById('manualSearchBox').style.display = 'flex';

                    images.forEach((url) => {
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
                    btn.innerText = '⏳ 카드뉴스 생성 중...';

                    try {
                        const response = await fetch('/api/generate-carousel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic, layout: selectedLayout })
                        });

                        const data = await response.json();
                        if (data.success) {
                            currentPostId = data.id;
                            currentBodyText = data.bodyText || '';
                            generatedImageUrls = data.imageUrls || [];
                            currentSlides = data.slides || [];
                            
                            document.getElementById('captionEditor').value = data.caption || '';
                            syncCaption();
                            renderHashtags(data.hashtags);
                            updateSlideViewer(0);
                            loadPostList();
                        } else {
                            alert('생성 실패: ' + (data.message || '알 수 없는 오류'));
                        }
                    } catch (err) {
                        alert('서버 통신 오류');
                    } finally {
                        btn.disabled = false;
                        btn.innerText = '🎨 카드뉴스 생성';
                    }
                }

                async function saveCurrentDraft() {
                    const caption = document.getElementById('captionEditor').value;
                    if (!caption) return alert('저장할 내용이 없습니다.');
                    
                    const res = await fetch('/api/posts/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            id: currentPostId,
                            category: currentCategory,
                            topic: selectedTopic || document.getElementById('customTopic').value || '수동 작성글', 
                            caption, 
                            bodyText: currentBodyText,
                            hashtags: currentHashtags,
                            imageUrl: currentImageUrl || 'https://placehold.co/600x600', 
                            candidateImages: currentCandidateImages,
                            imageUrls: generatedImageUrls,
                            layout: selectedLayout,
                            slides: currentSlides,
                            status: 'DRAFT',
                            scheduledAt: null
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.post) currentPostId = data.post.id;
                    alert('성공적으로 임시저장되었습니다.');
                    loadPostList();
                }

                // 스마트 예약 발행 등록 함수
                async function scheduleCurrentPost() {
                    const caption = document.getElementById('captionEditor').value;
                    const scheduleVal = document.getElementById('scheduleInput').value;
                    if (!caption) return alert('예약할 콘텐츠 내용이 없습니다.');
                    if (!scheduleVal) return alert('예약 일시를 선택해주세요.');

                    const scheduledAt = new Date(scheduleVal).toISOString();

                    const res = await fetch('/api/posts/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            id: currentPostId,
                            category: currentCategory,
                            topic: selectedTopic || document.getElementById('customTopic').value || '예약 콘텐츠', 
                            caption, 
                            bodyText: currentBodyText,
                            hashtags: currentHashtags,
                            imageUrl: currentImageUrl || 'https://placehold.co/600x600', 
                            candidateImages: currentCandidateImages,
                            imageUrls: generatedImageUrls,
                            layout: selectedLayout,
                            slides: currentSlides,
                            status: 'SCHEDULED',
                            scheduledAt: scheduledAt
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.post) currentPostId = data.post.id;

                    alert('⏰ [' + new Date(scheduleVal).toLocaleString('ko-KR') + '] 발행 예약이 등록되었습니다!');
                    loadPostList();
                }

                async function cancelSchedule(id) {
                    await fetch('/api/posts/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, status: 'DRAFT' })
                    });
                    loadPostList();
                }

                async function loadPostList() {
                    const storageList = document.getElementById('postStorageList');
                    try {
                        const res = await fetch('/api/posts');
                        const data = await res.json();
                        if (data.success && data.posts.length > 0) {
                            storageList.innerHTML = '';
                            
                            const scheduledCount = data.posts.filter(p => p.status === 'SCHEDULED').length;
                            document.getElementById('queueBadge').innerText = \`대기 \${scheduledCount}건\`;

                            data.posts.forEach(p => {
                                const isScheduled = p.status === 'SCHEDULED';
                                const isPublished = p.status === 'PUBLISHED';
                                const isFailed = p.status === 'FAILED';

                                let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">DRAFT</span>';
                                if (isScheduled) statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse">⏰ 예약대기</span>';
                                if (isPublished) statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ 발행완료</span>';
                                if (isFailed) statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">❌ 실패</span>';

                                const timeDisplay = isScheduled 
                                    ? \`<span class="text-amber-700 font-semibold">\${new Date(p.scheduledAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 발행예정</span>\`
                                    : (isPublished ? \`<span class="text-emerald-700">\${new Date(p.publishedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 발행됨</span>\` : new Date(p.updatedAt || p.createdAt).toLocaleDateString('ko-KR'));

                                const item = document.createElement('div');
                                item.className = "flex items-center justify-between p-3 border border-slate-200 rounded-xl text-xs " + (isScheduled ? "bg-amber-50/50 border-amber-200" : "bg-slate-50");
                                item.innerHTML = \`
                                    <div class="flex items-center space-x-3 overflow-hidden">
                                        <img src="\${p.imageUrl}" class="w-10 h-10 object-cover rounded-lg shrink-0">
                                        <div class="truncate">
                                            <div class="flex items-center gap-1.5">
                                                <span class="font-bold text-slate-800 truncate">\${p.topic}</span>
                                                \${statusBadge}
                                            </div>
                                            <div class="text-[11px] text-slate-400 mt-0.5">[\${p.category || '일반'}] \${timeDisplay}</div>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1.5 shrink-0">
                                        <button onclick="loadPostData('\${p.id}')" class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">편집</button>
                                        \${isScheduled ? \`<button onclick="cancelSchedule('\${p.id}')" class="px-2 py-1 bg-amber-200 text-amber-900 rounded-lg hover:bg-amber-300">예약취소</button>\` : ''}
                                        <button onclick="deletePost('\${p.id}')" class="px-2 py-1 bg-slate-200 text-slate-600 rounded-lg hover:bg-red-100 hover:text-red-600">삭제</button>
                                    </div>
                                \`;
                                storageList.appendChild(item);
                            });
                        } else {
                            storageList.innerHTML = '<div class="text-xs text-slate-400">저장된 콘텐츠가 없습니다.</div>';
                            document.getElementById('queueBadge').innerText = '0건';
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
                        currentPostId = post.id;
                        currentBodyText = post.bodyText || '';
                        document.getElementById('captionEditor').value = post.caption;
                        currentImageUrl = post.imageUrl;
                        selectedLayout = post.layout || 'modern';
                        
                        document.querySelectorAll('.layout-btn').forEach(btn => {
                            const active = btn.dataset.layout === selectedLayout;
                            btn.className = active
                                ? 'layout-btn p-2 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold transition'
                                : 'layout-btn p-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition';
                        });

                        generatedImageUrls = post.imageUrls || [];
                        currentSlides = post.slides || [];

                        syncCaption();
                        if (post.hashtags) renderHashtags(post.hashtags);

                        if (post.scheduledAt) {
                            const date = new Date(post.scheduledAt);
                            const localISO = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                            document.getElementById('scheduleInput').value = localISO;
                        }

                        if (generatedImageUrls.length > 0) {
                            updateSlideViewer(0);
                        } else {
                            document.getElementById('mockImage').src = post.imageUrl;
                            document.getElementById('slideIndicator').style.display = 'none';
                            document.getElementById('prevSlideBtn').style.display = 'none';
                            document.getElementById('nextSlideBtn').style.display = 'none';
                            document.getElementById('zipDownloadBtn').style.display = 'none';
                            document.getElementById('slideEditorSection').style.display = 'none';
                            if (post.candidateImages && post.candidateImages.length > 0) {
                                renderCandidates(post.candidateImages);
                            }
                        }
                    }
                }

                async function deletePost(id) {
                    if (!confirm('정말 삭제하시겠습니까?')) return;
                    await fetch(\`/api/posts/\${id}\`, { method: 'DELETE' });
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

                async function publishDirectToInstagram() {
                    const caption = document.getElementById('captionEditor').value;
                    if (!caption) return alert('게시할 캡션 내용이 없습니다.');
                    if (!confirm('실제 연결된 인스타그램 계정에 지금 바로 게시하시겠습니까?')) return;

                    const btn = document.getElementById('publishNowBtn');
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 인스타그램 업로드 중...';

                    try {
                        const res = await fetch('/api/publish-now', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                postId: currentPostId,
                                imageUrls: generatedImageUrls,
                                imageUrl: currentImageUrl,
                                caption: caption
                            })
                        });

                        const data = await res.json();
                        if (data.success) {
                            alert(\`🎉 인스타그램 피드 게시 성공!\n게시물 ID: \${data.postId}\`);
                            loadPostList();
                        } else {
                            alert(\`❌ 게시 실패: \${data.message}\`);
                        }
                    } catch (err) {
                        alert('서버 통신 중 오류가 발생했습니다.');
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = '🚀 인스타그램에 실제 바로 게시';
                    }
                }

                async function toggleAutoPilot() {
                    const interval = document.getElementById('autoInterval').value;
                    const autoSchedule = document.getElementById('autoScheduleCheck').checked;
                    isAutoEnabled = !isAutoEnabled;
                    const res = await fetch('/api/autopilot/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: isAutoEnabled, interval, autoSchedule })
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
    console.log(`✅ [완전자동화 & 스마트 예약 큐 & 실전 Meta Graph API 통합 완료] 서버 가동 (포트: ${port})`);
});
