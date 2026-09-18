require("dotenv").config();
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const { renderSlideBuffer, LAYOUTS } = require("./generateCards");

const FALLBACK_TRENDS = {
    "가족여행": ["3대 가족이 함께 가도 절대 안 싸우는 힐링 여행 코스", "주말 당일치기 서울 근교 숨은 감성 명소 TOP 5", "아이와 함께 가기 좋은 가성비 키즈 펜션 고르는 팁", "부모님 환갑·칠순 여행 만족도 200% 국내 여행지", "비 오는 날도 걱정 없는 실내 가족 나들이 명소"],
    "육아": ["육아책 100권 읽어도 안 나오는 현실 육아 치트키", "떼쓰는 아이 10초 만에 진정시키는 마법의 대화법", "초보 부모를 위한 10분 컷 기절 목욕 루틴", "밤마다 안 자는 아이를 위한 수면 교육 3일 완성", "육아 피로도 절반으로 줄여주는 생존 살림템 BEST 5"],
    "경제": ["돈이 저절로 모이는 통장 쪼개기 4단계 공식", "사회초년생 절대 놓치면 안 되는 연말정산 절세 치트키", "월급 200만원으로 1억 모으기 현실적인 로드맵", "초보자도 쉽게 따라 하는 미국 배당 ETF 적립식 투자법", "나도 모르게 줄줄 새는 구독료·고정지출 다이어트법"],
    "부동산": ["초보자도 10분 만에 끝내는 아파트 임장 필수 체크리스트", "전세계약 전 반드시 확인할 등기부등본 3대 독소조항", "신혼부부 특별공급 청약 가점 계산 및 당첨 전략", "빌라·원룸 구할 때 누수·수압·결로 단번에 잡아내는 법", "역세권 vs 학군지, 내 예산에 맞는 첫 집 마련 기준"],
    "호기심천국": ["비행기 창문 아래 작은 구멍의 충격적인 비밀", "엘리베이터 거울이 설치된 진짜 이유 (심리학적 반전)", "스마트폰 배터리 100% 완충하면 수명이 줄어들까?", "비행기 탑승권 바코드에 숨겨진 개인정보의 위험성", "고속도로 터널 조명이 주황색에서 흰색으로 바뀐 이유"],
    "생활팁": ["살림 고수들만 몰래 쓰는 만능 베이킹소다 활용법", "주방 찌든 기름때 5분 만에 말끔하게 녹여내는 비법", "옷장 곰팡이와 냄새 한 번에 잡는 천연 제습 꿀팁", "신발장 악취 싹 없애주는 커피 찌꺼기 200% 활용법", "얼룩진 흰 옷 새 옷처럼 되돌리는 과탄산소다 세탁법"],
    "결혼생활": ["부부싸움 90%를 예방하는 마법의 나-전달법(I-Message)", "결혼 10년 차가 알려주는 양가 부모님 명절 선물 공식", "사소한 집안일 갈등 끝내는 맞벌이 부부 가사분담 원칙", "서로 상처 주지 않고 재정권을 평화롭게 합치는 법", "주말 데이트가 지루해졌을 때 시도하는 이색 부부 취미"]
};

const DB_FILE = path.join(DATA_DIR, "posts.json");
let memoryPostsCache = [];

function loadPosts() {
    try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {}
    return memoryPostsCache;
}
function savePosts(posts) {
    memoryPostsCache = posts;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(posts, null, 2));
    } catch (e) { console.warn("ℹ️ 파일 저장 불가, 메모리 캐시 유지"); }
}

const BACKUP_IMAGES = [
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80",
    "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1080&q=80",
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1080&q=80",
    "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1080&q=80",
    "https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=1080&q=80",
    "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1080&q=80"
];

async function searchUnsplashImages(keyword, count = 4) {
    if (!UNSPLASH_ACCESS_KEY) return BACKUP_IMAGES.slice(0, count);
    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=${Math.min(count, 6)}&orientation=squarish&client_id=${UNSPLASH_ACCESS_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data?.results?.length > 0) return data.results.map(r => r.urls.regular);
    } catch (e) {}
    return BACKUP_IMAGES.slice(0, count);
}

function cleanJson(text) {
    let s = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
    const si = s.indexOf("{") !== -1 ? Math.min(s.indexOf("{"), s.indexOf("[") !== -1 ? s.indexOf("[") : Infinity) : s.indexOf("[");
    const ei = s.lastIndexOf("}") !== -1 && s.lastIndexOf("}") > s.lastIndexOf("]") ? s.lastIndexOf("}") : s.lastIndexOf("]");
    if (si !== -1 && ei !== -1 && ei > si) s = s.slice(si, ei + 1);
    return JSON.parse(s);
}

function classifyAiError(err) {
    const msg = String(err?.message || "");
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("too many requests"))
        return { code: "QUOTA_EXCEEDED", userMessage: "🚫 API 일일 한도가 초과되었습니다. 새 API 키를 입력하거나 내일 다시 시도해주세요." };
    if (msg.includes("401") || msg.toLowerCase().includes("not valid") || msg.toLowerCase().includes("invalid api"))
        return { code: "INVALID_KEY", userMessage: "🔑 API 키가 유효하지 않습니다. 키를 다시 확인해주세요." };
    if (msg.includes("503") || msg.toLowerCase().includes("high demand") || msg.toLowerCase().includes("service unavailable"))
        return { code: "SERVER_OVERLOAD", userMessage: "⚠️ AI 서버 일시 과부하. 잠시 후 다시 시도해주세요." };
    if (msg.includes("초과") || msg.toLowerCase().includes("timeout"))
        return { code: "TIMEOUT", userMessage: "⏱️ AI 응답 시간 초과. 다시 시도해주세요." };
    return { code: "UNKNOWN", userMessage: "AI 생성 오류: " + msg };
}

function validateAiConfig(config = {}) {
    const provider = config.provider === "openai" ? "openai" : "gemini";
    let apiKey = String(config.apiKey || "").trim();
    let model = String(config.model || "").trim();
    if (!apiKey) apiKey = provider === "gemini" ? (process.env.GEMINI_API_KEY || "") : (process.env.OPENAI_API_KEY || "");
    if (!model) model = provider === "gemini" ? (process.env.GEMINI_MODEL || "gemini-flash-latest") : "gpt-4o-mini";
    if (!apiKey) throw new Error("API 키가 없습니다. 화면 상단에서 API 키를 입력해주세요.");
    return { provider, apiKey, model };
}

async function generateWithAi(config, prompt, jsonMode = false) {
    const { provider, apiKey, model } = validateAiConfig(config);
    if (provider === "gemini") {
        const client = new GoogleGenerativeAI(apiKey);
        const candidates = [model, "gemini-flash-latest", "gemini-2.5-flash"].filter((v, i, a) => a.indexOf(v) === i);
        let lastError = null;
        for (const m of candidates) {
            try {
                const result = await Promise.race([
                    client.getGenerativeModel({ model: m, generationConfig: jsonMode ? { responseMimeType: "application/json" } : undefined }).generateContent(prompt),
                    new Promise((_, rej) => setTimeout(() => rej(new Error("응답 시간 초과 (20초)")), 20000))
                ]);
                return result.response.text();
            } catch (err) {
                lastError = err;
                const cls = classifyAiError(err);
                if (cls.code === "QUOTA_EXCEEDED" || cls.code === "INVALID_KEY") throw err;
                console.warn(`⚠️ 모델(${m}) 실패: ${err.message}`);
            }
        }
        throw lastError;
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.85, response_format: jsonMode ? { type: "json_object" } : undefined }),
        signal: AbortSignal.timeout(25000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI API 오류");
    return data.choices?.[0]?.message?.content || "";
}

function getSeason() {
    return ["겨울","겨울","봄","봄","봄","여름","여름","여름","가을","가을","가을","겨울"][new Date().getMonth()];
}
function getDateCtx() {
    const n = new Date();
    return `${n.getFullYear()}년 ${n.getMonth()+1}월 ${n.getDate()}일`;
}

// ===== API =====

app.get("/api/config-status", (req, res) => {
    res.json({ success: true, hasGeminiKey: !!(process.env.GEMINI_API_KEY?.trim()), hasOpenAiKey: !!(process.env.OPENAI_API_KEY?.trim()), defaultModel: process.env.GEMINI_MODEL || "gemini-flash-latest" });
});

app.post("/api/models", async (req, res) => {
    const defaultGemini = ["gemini-flash-latest","gemini-3.8-flash","gemini-3.6-flash","gemini-3.5-flash","gemini-2.5-flash","gemini-2.5-pro","gemini-pro-latest"];
    const defaultOpenAi = ["gpt-4.1-mini","gpt-4o-mini","gpt-4.1","gpt-4o","gpt-5-mini","gpt-5"];
    const provider = req.body?.provider === "openai" ? "openai" : "gemini";
    try {
        let apiKey = String(req.body?.apiKey || "").trim() || (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) || "";
        if (!apiKey) return res.json({ success: true, models: provider === "openai" ? defaultOpenAi : defaultGemini });
        if (provider === "gemini") {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(6000) });
            const d = await r.json();
            if (!r.ok) throw new Error(d?.error?.message || "조회 실패");
            const models = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, "")).sort().reverse();
            return res.json({ success: true, models: models.length ? models : defaultGemini });
        } else {
            const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(6000) });
            const d = await r.json();
            if (!r.ok) throw new Error(d?.error?.message || "조회 실패");
            const models = (d.data || []).map(m => m.id).filter(id => /^(gpt-|o[0-9]|chatgpt-)/.test(id)).sort().reverse();
            return res.json({ success: true, models: models.length ? models : defaultOpenAi });
        }
    } catch (e) {
        res.json({ success: true, models: provider === "openai" ? defaultOpenAi : defaultGemini, warning: e.message });
    }
});

app.post("/api/trends", async (req, res) => {
    const { category = "가족여행", aiConfig } = req.body;
    const fallback = FALLBACK_TRENDS[category] || FALLBACK_TRENDS["가족여행"];
    try {
        const prompt = `당신은 한국 인스타그램 트렌드 전문 크리에이터입니다.\n오늘: ${getDateCtx()} (${getSeason()} 시즌) | 카테고리: [${category}]\n\n지금 이 시기 한국 인스타그램에서 저장률·공유율이 높을 만한 카드뉴스 주제 5개를 제안하세요.\n- 식상하거나 추상적인 표현 절대 금지 ("꿀팁 모음", "정보 공유" 등)\n- 제목만 봐도 저장하고 싶은 충동이 드는 구체적이고 후킹이 강한 문장\n- 계절/시즌 자연스럽게 반영, 허위·과장 금지, 50자 이내 문장형\n\nJSON 배열만 응답 (다른 텍스트 없이): ["주제1","주제2","주제3","주제4","주제5"]`;
        const text = await Promise.race([
            generateWithAi(aiConfig, prompt, true),
            new Promise((_, rej) => setTimeout(() => rej(new Error("응답 시간 초과")), 18000))
        ]);
        const parsed = cleanJson(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`✅ [${category}] AI 트렌드 생성 완료`);
            return res.json({ success: true, trends: parsed, isAI: true });
        }
        throw new Error("파싱 실패");
    } catch (e) {
        const cls = classifyAiError(e);
        console.warn(`ℹ️ 트렌드 AI 실패(${cls.code}): ${e.message}`);
        res.json({ success: true, trends: fallback, isPreset: true, errorCode: cls.code, errorMessage: cls.userMessage });
    }
});

app.post("/api/generate-post", async (req, res) => {
    const { topic, category, aiConfig } = req.body;
    const cat = category || "가족여행";
    const topicStr = (topic || cat).trim();
    try {
        const prompt = `당신은 ${getDateCtx()} ${getSeason()} 시즌 한국 인스타그램 전문 에디터입니다.\n\n[주제]: "${topicStr}"\n[카테고리]: ${cat}\n\n위 주제에 완전히 집중하여 인스타그램 게시글을 작성하세요:\n- 검증되지 않은 수치·의학·금융 조언 단정 금지\n- 첫 문장: 독자가 스크롤을 멈출 수밖에 없는 강한 후킹 (이모지 활용 가능)\n- 본문: 읽기 좋게 문단 구분, 주제와 직접 관련된 구체적 정보 3~5문단\n- imageKeyword: 이 주제와 가장 잘 어울리는 구체적인 영어 이미지 검색어 (2~4단어)\n- hashtags: 주제와 카테고리에 딱 맞는 한국어 해시태그 각 5개씩\n\nJSON만 응답:\n{"imageKeyword":"specific english keyword","bodyText":"캡션 본문 전체","hashtags":{"core":["#태그1","#태그2","#태그3","#태그4","#태그5"],"expand":["#태그1","#태그2","#태그3","#태그4","#태그5"],"target":["#태그1","#태그2","#태그3","#태그4","#태그5"]}}`;
        const parsed = cleanJson(await generateWithAi(aiConfig, prompt, true));
        console.log(`✅ 게시글 생성: "${topicStr}"`);
        const images = await searchUnsplashImages(parsed.imageKeyword || topicStr, 6);
        const allTags = [...(parsed.hashtags?.core||[]),...(parsed.hashtags?.expand||[]),...(parsed.hashtags?.target||[])].join(" ");
        res.json({ success: true, imageUrl: images[0], candidateImages: images, imageKeyword: parsed.imageKeyword, bodyText: parsed.bodyText||"", hashtags: parsed.hashtags||{core:[],expand:[],target:[]}, caption: (parsed.bodyText||"") + "\n\n" + allTags, topic: topicStr });
    } catch (e) {
        const cls = classifyAiError(e);
        console.error(`❌ 게시글 생성 실패(${cls.code}): ${e.message}`);
        res.status(500).json({ success: false, errorCode: cls.code, message: cls.userMessage });
    }
});

app.post("/api/generate-carousel", async (req, res) => {
    const { topic, layout, category, aiConfig } = req.body;
    const cat = category || "가족여행";
    const topicStr = (topic || cat).trim();
    try {
        const prompt = `당신은 ${getDateCtx()} ${getSeason()} 시즌 한국 인스타그램 카드뉴스 전문 에디터입니다.\n\n[선택된 트렌드 주제]: "${topicStr}"\n[카테고리]: ${cat}\n\n위 주제에 완전히 집중하여 5장 카드뉴스를 만드세요:\n- 표지(cover): 주제 핵심을 담은 2줄 이하 강렬한 후킹 제목 + 부제\n- 본문 3장(body): 각기 다른 구체적 인사이트/팁/사례 (막연한 내용 금지, 숫자·사례 포함)\n- 아웃트로(outro): 저장·팔로우 유도 자연스러운 CTA\n- imageKeyword: 각 슬라이드 내용과 직접 연관된 구체적 영어 키워드\n- bodyText: 인스타그램 캡션 본문 (후킹 첫 문장 포함)\n- hashtags: 주제와 직접 관련된 한국어 해시태그 각 5개\n\n정확히 5장 JSON만 응답:\n{"bodyText":"캡션 본문","hashtags":{"core":["#태그","#태그","#태그","#태그","#태그"],"expand":["#태그","#태그","#태그","#태그","#태그"],"target":["#태그","#태그","#태그","#태그","#태그"]},"slides":[{"type":"cover","imageKeyword":"specific english keyword","title":"제목(2줄이하)","subtitle":"부제"},{"type":"body","imageKeyword":"keyword","step":"01","title":"소제목","content":"구체적 내용(2~3문장)"},{"type":"body","imageKeyword":"keyword","step":"02","title":"소제목","content":"구체적 내용(2~3문장)"},{"type":"body","imageKeyword":"keyword","step":"03","title":"소제목","content":"구체적 내용(2~3문장)"},{"type":"outro","imageKeyword":"keyword","title":"저장 CTA","subtitle":"짧은 안내"}]}`;
        const aiData = cleanJson(await generateWithAi(aiConfig, prompt, true));
        console.log(`✅ 카드뉴스 생성: "${topicStr}"`);
        for (const slide of aiData.slides || []) {
            const imgs = await searchUnsplashImages(slide.imageKeyword || topicStr, 1);
            slide.imageUrl = imgs[0];
        }
        const sel = LAYOUTS[layout] ? layout : "modern";
        const allTags = [...(aiData.hashtags?.core||[]),...(aiData.hashtags?.expand||[]),...(aiData.hashtags?.target||[])].join(" ");
        res.json({ success: true, caption: (aiData.bodyText||"") + "\n\n" + allTags, bodyText: aiData.bodyText||"", hashtags: aiData.hashtags||{core:[],expand:[],target:[]}, layout: sel, slides: aiData.slides||[], topic: topicStr });
    } catch (e) {
        const cls = classifyAiError(e);
        console.error(`❌ 카드뉴스 생성 실패(${cls.code}): ${e.message}`);
        res.status(500).json({ success: false, errorCode: cls.code, message: cls.userMessage });
    }
});

app.post("/api/rerender-slide", async (req, res) => {
    try {
        const { slide, index, total, layout } = req.body;
        const image = await renderSlideBuffer(slide, index, total, { layout: LAYOUTS[layout] ? layout : "modern" });
        res.set("Cache-Control", "no-store").type("png").send(image);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get("/api/search-images", async (req, res) => {
    const images = await searchUnsplashImages(req.query.keyword || "lifestyle", 6);
    res.json({ success: true, images });
});

app.get("/", (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>인스타그램 AI 크리에이터</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
<style>
* { font-family: "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; box-sizing: border-box; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.fade-in { animation: fadeIn 0.35s ease; }
@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; } }
.slide-thumb { transition: all 0.2s; cursor: pointer; }
.slide-thumb:hover { transform: scale(0.96); }
.slide-thumb.active { outline: 3px solid #6366f1; transform: scale(0.93); }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.tag-chip { transition: all 0.15s; cursor: pointer; user-select: none; }
</style>
</head>
<body class="bg-gradient-to-br from-slate-100 to-indigo-50 min-h-screen">

<div id="errorBanner" class="hidden fixed top-0 left-0 right-0 z-50 px-4 py-3 text-sm font-bold text-center text-white shadow-xl" style="background:linear-gradient(90deg,#dc2626,#b91c1c);">
  <span id="errorBannerText"></span>
  <a href="https://aistudio.google.com/app/apikey" target="_blank" class="ml-3 underline text-white/90">새 API 키 발급 →</a>
  <button onclick="document.getElementById('errorBanner').classList.add('hidden')" class="ml-4 text-white/70 hover:text-white">✕</button>
</div>

<div class="max-w-7xl mx-auto p-4 space-y-4">
  <header class="bg-white/80 backdrop-blur rounded-2xl shadow-sm border border-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-extrabold text-slate-800">📸 인스타그램 AI 크리에이터</h1>
      <p class="text-xs text-slate-500 mt-0.5">카테고리 선택 → AI 실시간 트렌드 생성 → 게시글 & 카드뉴스 자동 작성</p>
    </div>
    <span id="keyBadge" class="text-[11px] font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-400">키 확인 중...</span>
  </header>

  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
    <div class="lg:col-span-5 space-y-4">

      <!-- AI 모델 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <label class="block text-sm font-bold text-slate-700 mb-3">🔐 AI 모델 연결</label>
        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <select id="aiProvider" onchange="onProviderChange()" class="border border-slate-200 rounded-xl p-2.5 text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI ChatGPT</option>
            </select>
            <select id="aiModel" class="border border-slate-200 rounded-xl p-2.5 text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              <option value="gemini-flash-latest">gemini-flash-latest</option>
            </select>
          </div>
          <div class="flex gap-2">
            <input id="aiApiKey" type="password" autocomplete="off" placeholder="API 키 (비워두면 .env 자동 사용)" class="flex-1 border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
            <button onclick="loadModels()" class="px-4 rounded-xl bg-slate-800 hover:bg-black text-white text-xs font-bold transition whitespace-nowrap">갱신</button>
          </div>
        </div>
      </div>

      <!-- 카테고리 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">🗂 관심 카테고리 <span class="text-slate-400 font-normal text-xs">(선택 시 AI가 트렌드 자동 생성)</span></label>
        <div class="flex flex-wrap gap-2" id="categoryChips">
          <button onclick="selectCategory('가족여행')" class="cat-chip px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow">🏖️ 가족여행</button>
          <button onclick="selectCategory('육아')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">🍼 육아</button>
          <button onclick="selectCategory('경제')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">📈 경제</button>
          <button onclick="selectCategory('부동산')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">🏢 부동산</button>
          <button onclick="selectCategory('호기심천국')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">💡 호기심천국</button>
          <button onclick="selectCategory('생활팁')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">🧹 생활팁</button>
          <button onclick="selectCategory('결혼생활')" class="cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl">💍 결혼생활</button>
        </div>
      </div>

      <!-- 트렌드 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <div class="flex items-center justify-between mb-3">
          <label class="text-sm font-bold text-slate-700">🔥 AI 실시간 트렌드 주제</label>
          <button onclick="fetchTrends()" id="trendRefreshBtn" class="text-xs text-indigo-500 hover:text-indigo-700 font-semibold flex items-center gap-1">
            <i class="fa-solid fa-rotate-right text-[10px]"></i> 새로고침
          </button>
        </div>
        <div id="trendList" class="space-y-1.5 min-h-[80px]">
          <div class="flex items-center gap-2 text-xs text-slate-400 p-2">
            <svg class="spin h-4 w-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            AI 트렌드 주제 생성 중...
          </div>
        </div>
      </div>

      <!-- 주제 입력 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">✍️ 주제 직접 입력</label>
        <input type="text" id="customTopic" class="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" placeholder="위에서 클릭하거나 직접 입력하세요">
      </div>

      <!-- 레이아웃 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">🎨 카드뉴스 디자인</label>
        <div class="grid grid-cols-5 gap-1.5" id="layoutSelector">
          <button onclick="selectLayout('modern')" data-layout="modern" class="layout-btn py-2 rounded-xl border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold">모던</button>
          <button onclick="selectLayout('editorial')" data-layout="editorial" class="layout-btn py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">에디토리얼</button>
          <button onclick="selectLayout('split')" data-layout="split" class="layout-btn py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">스플릿</button>
          <button onclick="selectLayout('card')" data-layout="card" class="layout-btn py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">카드</button>
          <button onclick="selectLayout('minimal')" data-layout="minimal" class="layout-btn py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">미니멀</button>
        </div>
      </div>

      <!-- 생성 버튼 -->
      <div class="grid grid-cols-2 gap-3">
        <button id="genPostBtn" onclick="handleGeneratePost()" class="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 text-sm">
          <i class="fa-solid fa-newspaper"></i> 게시글 생성
        </button>
        <button id="genCardBtn" onclick="handleGenerateCarousel()" class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 rounded-2xl shadow-lg transition flex items-center justify-center gap-2 text-sm">
          <i class="fa-solid fa-layer-group"></i> 카드뉴스 생성
        </button>
      </div>
    </div>

    <!-- 결과 패널 -->
    <div class="lg:col-span-7 space-y-4">

      <div id="emptyState" class="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
        <div class="text-6xl mb-4">✨</div>
        <p class="text-slate-500 font-semibold">카테고리 선택 → 트렌드 주제 클릭 → 생성 버튼 클릭</p>
        <p class="text-slate-400 text-xs mt-2">게시글 생성: 이미지+캡션 | 카드뉴스 생성: 5장 슬라이드</p>
      </div>

      <!-- 게시글 결과 -->
      <div id="postResultSection" class="hidden bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 flex items-center justify-between">
          <span class="text-white font-bold text-sm"><i class="fa-solid fa-newspaper mr-2"></i>게시글 결과</span>
          <span id="postTopicBadge" class="text-indigo-100 text-xs truncate max-w-xs"></span>
        </div>
        <div class="p-5">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <div class="aspect-square rounded-2xl overflow-hidden bg-slate-100 relative group">
                <img id="postImage" src="" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <button onclick="downloadPostImage()" class="bg-white text-slate-800 font-bold px-4 py-2 rounded-xl text-xs shadow flex items-center gap-2"><i class="fa-solid fa-download"></i> 저장</button>
                </div>
              </div>
              <div id="postCandidateGrid" class="grid grid-cols-3 gap-1.5 mt-2"></div>
            </div>
            <div class="flex flex-col gap-3">
              <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">📝 인스타그램 캡션</label>
                <textarea id="postCaption" oninput="syncPostCaptionInfo()" rows="8" class="w-full border border-slate-200 rounded-xl p-3 text-xs leading-relaxed focus:ring-2 focus:ring-indigo-400 focus:outline-none resize-none"></textarea>
                <div id="postCaptionInfo" class="text-[10px] text-slate-400 mt-1 text-right">0자 / 0개</div>
              </div>
              <div id="postHashtagSection" class="hidden space-y-1.5">
                <label class="block text-xs font-bold text-slate-600">🏷️ 해시태그 <span class="font-normal text-slate-400">(클릭으로 추가/제거)</span></label>
                <div><span class="text-[10px] font-bold text-indigo-600">핵심</span><div id="postCoreTags" class="flex flex-wrap gap-1 mt-1"></div></div>
                <div><span class="text-[10px] font-bold text-purple-600">확장</span><div id="postExpandTags" class="flex flex-wrap gap-1 mt-1"></div></div>
                <div><span class="text-[10px] font-bold text-emerald-600">타깃</span><div id="postTargetTags" class="flex flex-wrap gap-1 mt-1"></div></div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
            <button onclick="downloadPostImage()" class="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-sm transition shadow">
              <i class="fa-solid fa-image"></i> 이미지 저장
            </button>
            <button onclick="copyPostCaption()" id="copyPostBtn" class="flex items-center justify-center gap-2 bg-slate-800 hover:bg-black text-white font-bold py-3 rounded-xl text-sm transition shadow">
              <i class="fa-solid fa-copy"></i> 캡션 복사
            </button>
          </div>
        </div>
      </div>

      <!-- 카드뉴스 결과 -->
      <div id="carouselResultSection" class="hidden bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 flex items-center justify-between">
          <span class="text-white font-bold text-sm"><i class="fa-solid fa-layer-group mr-2"></i>카드뉴스 결과</span>
          <span id="carouselTopicBadge" class="text-purple-100 text-xs truncate max-w-xs"></span>
        </div>
        <div class="p-5 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div class="aspect-square rounded-2xl overflow-hidden bg-slate-100 relative group">
                <img id="carouselMainImage" src="" class="w-full h-full object-cover">
                <div class="absolute top-2 right-2 bg-black/60 text-white text-[11px] font-bold px-2 py-1 rounded-lg" id="slideIndicator">1 / 5</div>
                <button onclick="navigateSlide(-1)" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">&#10094;</button>
                <button onclick="navigateSlide(1)" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 text-white w-8 h-8 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">&#10095;</button>
              </div>
              <div id="carouselThumbnails" class="grid grid-cols-5 gap-1.5 mt-2"></div>
            </div>
            <div class="flex flex-col gap-3">
              <div id="slideEditorPanel" class="hidden space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label class="block text-xs font-bold text-slate-600" id="slideEditorLabel">슬라이드 편집</label>
                <input type="text" id="editTitle" oninput="onSlideEdit()" placeholder="제목" class="w-full border border-slate-200 rounded-lg p-2 text-xs font-bold focus:ring-2 focus:ring-purple-400 focus:outline-none bg-white">
                <input type="text" id="editSubtitle" oninput="onSlideEdit()" placeholder="부제목" class="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-400 focus:outline-none bg-white">
                <textarea id="editContent" oninput="onSlideEdit()" rows="2" placeholder="본문 (body 슬라이드)" class="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-400 focus:outline-none resize-none bg-white"></textarea>
                <div class="flex gap-2">
                  <input type="text" id="editImgKeyword" oninput="onSlideEdit()" placeholder="이미지 키워드 (영문)" class="flex-1 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-400 focus:outline-none bg-white">
                  <button onclick="reSearchSlideImage()" class="px-3 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-lg">재검색</button>
                </div>
                <button onclick="rerenderCurrentSlide()" class="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg">&#9889; 수정 내용 반영</button>
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">📝 카드뉴스 캡션</label>
                <textarea id="carouselCaption" rows="6" class="w-full border border-slate-200 rounded-xl p-3 text-xs leading-relaxed focus:ring-2 focus:ring-purple-400 focus:outline-none resize-none"></textarea>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
            <button onclick="downloadCarouselZip()" id="zipBtn" class="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl text-sm transition shadow">
              <i class="fa-solid fa-file-zipper"></i> ZIP 저장 (5장)
            </button>
            <button onclick="copyCarouselCaption()" id="copyCarouselBtn" class="flex items-center justify-center gap-2 bg-slate-800 hover:bg-black text-white font-bold py-3 rounded-xl text-sm transition shadow">
              <i class="fa-solid fa-copy"></i> 캡션 복사
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>
<script>
var currentCategory="가족여행",selectedTopic="",selectedLayout="modern",currentSlides=[],currentSlideIndex=0,carouselImageUrls=[],postCurrentImageUrl="",postBodyText="",postSelectedTags=new Set(),postAllHashtags={core:[],expand:[],target:[]};
window.onload=function(){checkConfigAndInit();};
async function checkConfigAndInit(){
    try{var r=await fetch("/api/config-status"),d=await r.json(),b=document.getElementById("keyBadge");
    if(d.hasGeminiKey||d.hasOpenAiKey){b.className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700";b.innerText="🟢 API 키 연결됨";}
    else{b.className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-700";b.innerText="🟡 API 키 입력 필요";}
    if(d.defaultModel){var s=document.getElementById("aiModel");if(s)s.value=d.defaultModel;}}catch(e){}
    await loadModels(true);await fetchTrends();
}
function getAiConfig(){return{provider:document.getElementById("aiProvider").value,apiKey:document.getElementById("aiApiKey").value.trim(),model:document.getElementById("aiModel").value};}
function getStaticModels(p){
    if(p==="gemini")return"<option value='gemini-flash-latest'>gemini-flash-latest</option><option value='gemini-3.8-flash'>gemini-3.8-flash</option><option value='gemini-3.6-flash'>gemini-3.6-flash</option><option value='gemini-2.5-flash'>gemini-2.5-flash</option><option value='gemini-2.5-pro'>gemini-2.5-pro</option><option value='gemini-pro-latest'>gemini-pro-latest</option>";
    return"<option value='gpt-4.1-mini'>gpt-4.1-mini</option><option value='gpt-4o-mini'>gpt-4o-mini</option><option value='gpt-4.1'>gpt-4.1</option><option value='gpt-4o'>gpt-4o</option>";
}
function onProviderChange(){document.getElementById("aiModel").innerHTML=getStaticModels(document.getElementById("aiProvider").value);loadModels(true);}
async function loadModels(silent){
    var cfg=getAiConfig(),sel=document.getElementById("aiModel");
    if(!silent)sel.innerHTML="<option>조회 중...</option>";
    try{var r=await fetch("/api/models",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(cfg),signal:AbortSignal.timeout(10000)}),d=await r.json();
    if(d.success&&d.models&&d.models.length){sel.innerHTML=d.models.map(function(m){return"<option value='"+m+"'>"+m+"</option>";}).join("");var pref=cfg.provider==="openai"?"gpt-4.1-mini":"gemini-flash-latest";if(d.models.includes(pref))sel.value=pref;}else throw new Error("empty");}
    catch(e){sel.innerHTML=getStaticModels(cfg.provider);if(!silent)showError("모델 목록 불러오기 실패");}
}
function selectCategory(cat){
    currentCategory=cat;selectedTopic="";document.getElementById("customTopic").value="";
    document.querySelectorAll(".cat-chip").forEach(function(btn){var a=btn.innerText.indexOf(cat)!==-1;btn.className=a?"cat-chip px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow":"cat-chip px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl";});
    fetchTrends();
}
async function fetchTrends(){
    var list=document.getElementById("trendList"),btn=document.getElementById("trendRefreshBtn");
    if(btn)btn.disabled=true;
    list.innerHTML="<div class='flex items-center gap-2 text-xs text-indigo-500 p-2'><svg class='spin h-4 w-4 shrink-0' fill='none' viewBox='0 0 24 24'><circle class='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' stroke-width='4'/><path class='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v8z'/></svg><span>AI가 <b>"+currentCategory+"</b> 실시간 트렌드를 생성하는 중...</span></div>";
    try{
        var r=await fetch("/api/trends",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:currentCategory,aiConfig:getAiConfig()}),signal:AbortSignal.timeout(22000)}),d=await r.json();
        if(d.errorCode==="QUOTA_EXCEEDED"||d.errorCode==="INVALID_KEY")showError(d.errorMessage||"API 오류");
        var trends=(d.success&&Array.isArray(d.trends)&&d.trends.length)?d.trends:["트렌드를 불러오지 못했습니다."];
        list.innerHTML="";
        var badge=document.createElement("div");
        badge.className=d.isAI?"text-[10px] text-emerald-600 font-bold mb-2":"text-[10px] text-amber-600 font-semibold mb-2";
        badge.innerHTML=d.isAI?"✨ AI가 오늘 날짜 기준으로 실시간 생성한 트렌드입니다":"📋 저장된 추천 주제 (AI 응답 지연 시 자동 대체)";
        list.appendChild(badge);
        trends.forEach(function(t,i){
            var item=document.createElement("div");
            item.className="p-2.5 border border-slate-200 rounded-xl text-xs text-slate-700 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition flex items-center justify-between";
            item.innerHTML="<span class='flex-1 font-medium'><span class='text-indigo-600 font-bold mr-1.5'>"+(i+1)+".</span>"+t+"</span><span class='text-[10px] text-slate-400 shrink-0 ml-2'>선택 →</span>";
            item.onclick=function(){
                document.querySelectorAll("#trendList > div").forEach(function(el){if(el!==badge)el.className="p-2.5 border border-slate-200 rounded-xl text-xs text-slate-700 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition flex items-center justify-between";});
                item.className="p-2.5 border-2 border-indigo-500 bg-indigo-50 rounded-xl text-xs text-indigo-900 font-bold cursor-pointer transition flex items-center justify-between shadow-sm";
                selectedTopic=t;document.getElementById("customTopic").value=t;
            };
            list.appendChild(item);
        });
    }catch(e){list.innerHTML="<div class='text-xs text-red-400 p-2'>트렌드 로드 실패: "+e.message+"</div>";}
    finally{if(btn)btn.disabled=false;}
}
function selectLayout(l){
    selectedLayout=l;
    document.querySelectorAll(".layout-btn").forEach(function(b){var a=b.dataset.layout===l;b.className=a?"layout-btn py-2 rounded-xl border-2 border-indigo-500 bg-indigo-50 text-indigo-700 text-xs font-bold":"layout-btn py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50";});
    if(currentSlides.length>0)renderAllSlides();
}
function showError(msg){document.getElementById("errorBannerText").innerText=msg;var b=document.getElementById("errorBanner");b.classList.remove("hidden");setTimeout(function(){b.classList.add("hidden");},12000);}
function setBtn(id,loading,orig){var btn=document.getElementById(id);if(!btn)return;btn.disabled=loading;if(loading)btn.innerHTML="<svg class='spin h-4 w-4 inline' fill='none' viewBox='0 0 24 24'><circle class='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' stroke-width='4'/><path class='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v8z'/></svg> 생성 중...";else btn.innerHTML=orig;}
async function handleGeneratePost(){
    var topic=document.getElementById("customTopic").value.trim()||selectedTopic||currentCategory;
    setBtn("genPostBtn",true,"");document.getElementById("emptyState").classList.add("hidden");
    try{
        var r=await fetch("/api/generate-post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({topic:topic,category:currentCategory,aiConfig:getAiConfig()})}),d=await r.json();
        if(!d.success){showError(d.message||"게시글 생성 실패");return;}
        postCurrentImageUrl=d.imageUrl;postBodyText=d.bodyText||"";postAllHashtags=d.hashtags||{core:[],expand:[],target:[]};
        postSelectedTags=new Set([].concat(postAllHashtags.core||[],postAllHashtags.expand||[],postAllHashtags.target||[]));
        document.getElementById("postImage").src=d.imageUrl;
        var grid=document.getElementById("postCandidateGrid");grid.innerHTML="";
        (d.candidateImages||[]).forEach(function(url,idx){
            var img=document.createElement("img");img.src=url;img.className="aspect-square object-cover rounded-lg cursor-pointer border-2 transition "+(idx===0?"border-indigo-500":"border-transparent hover:border-slate-300");
            img.onclick=function(){postCurrentImageUrl=url;document.getElementById("postImage").src=url;grid.querySelectorAll("img").forEach(function(i2){i2.className="aspect-square object-cover rounded-lg cursor-pointer border-2 transition border-transparent hover:border-slate-300";});img.className="aspect-square object-cover rounded-lg cursor-pointer border-2 transition border-indigo-500";};
            grid.appendChild(img);
        });
        renderPostTags("postCoreTags",postAllHashtags.core||[],"indigo");
        renderPostTags("postExpandTags",postAllHashtags.expand||[],"purple");
        renderPostTags("postTargetTags",postAllHashtags.target||[],"emerald");
        document.getElementById("postHashtagSection").classList.remove("hidden");
        refreshPostCaption();document.getElementById("postTopicBadge").innerText="주제: "+topic;
        var sec=document.getElementById("postResultSection");sec.classList.remove("hidden");sec.classList.add("fade-in");sec.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){showError("게시글 생성 오류: "+e.message);}
    finally{setBtn("genPostBtn",false,"<i class='fa-solid fa-newspaper'></i> 게시글 생성");}
}
function refreshPostCaption(){var tags=Array.from(postSelectedTags).join(" ");document.getElementById("postCaption").value=postBodyText+(tags?"\n\n"+tags:"");syncPostCaptionInfo();}
function syncPostCaptionInfo(){var v=document.getElementById("postCaption").value||"",tc=(v.match(/#[^\s#]+/g)||[]).length;document.getElementById("postCaptionInfo").innerText=v.length+"자 / 해시태그 "+tc+"개";}
var colorMap={indigo:"bg-indigo-50 text-indigo-700 border-indigo-200",purple:"bg-purple-50 text-purple-700 border-purple-200",emerald:"bg-emerald-50 text-emerald-700 border-emerald-200"};
function renderPostTags(containerId,tags,color){
    var el=document.getElementById(containerId);el.innerHTML="";
    tags.forEach(function(tag){
        var chip=document.createElement("button"),active=postSelectedTags.has(tag);
        chip.className="tag-chip text-[10px] px-2 py-0.5 rounded-lg border font-medium "+(active?colorMap[color]:"bg-slate-50 text-slate-400 border-slate-200 line-through");
        chip.innerText=tag;chip.onclick=function(){if(postSelectedTags.has(tag))postSelectedTags.delete(tag);else postSelectedTags.add(tag);renderPostTags(containerId,tags,color);refreshPostCaption();};
        el.appendChild(chip);
    });
}
function downloadPostImage(){
    if(!postCurrentImageUrl){showError("먼저 게시글을 생성해주세요.");return;}
    var topic=(document.getElementById("customTopic").value.trim()||selectedTopic||currentCategory).replace(/[\\/\:*?"<>|]/g,"_").substring(0,30);
    var a=document.createElement("a");a.href=postCurrentImageUrl;a.download=topic+"_게시글.jpg";a.target="_blank";document.body.appendChild(a);a.click();document.body.removeChild(a);
}
function copyPostCaption(){
    var cap=document.getElementById("postCaption").value;if(!cap){showError("먼저 게시글을 생성해주세요.");return;}
    navigator.clipboard.writeText(cap).then(function(){var btn=document.getElementById("copyPostBtn"),orig=btn.innerHTML;btn.innerHTML="<i class='fa-solid fa-check'></i> 복사됨!";setTimeout(function(){btn.innerHTML=orig;},2000);});
}
async function handleGenerateCarousel(){
    var topic=document.getElementById("customTopic").value.trim()||selectedTopic||currentCategory;
    setBtn("genCardBtn",true,"");document.getElementById("emptyState").classList.add("hidden");
    try{
        var r=await fetch("/api/generate-carousel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({topic:topic,layout:selectedLayout,category:currentCategory,aiConfig:getAiConfig()})}),d=await r.json();
        if(!d.success){showError(d.message||"카드뉴스 생성 실패");return;}
        currentSlides=d.slides||[];currentSlideIndex=0;carouselImageUrls=[];
        document.getElementById("carouselCaption").value=d.caption||"";document.getElementById("carouselTopicBadge").innerText="주제: "+topic;
        await renderAllSlides();
        var sec=document.getElementById("carouselResultSection");sec.classList.remove("hidden");sec.classList.add("fade-in");sec.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){showError("카드뉴스 생성 오류: "+e.message);}
    finally{setBtn("genCardBtn",false,"<i class='fa-solid fa-layer-group'></i> 카드뉴스 생성");}
}
async function renderSlideImage(idx){var r=await fetch("/api/rerender-slide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slide:currentSlides[idx],index:idx,total:currentSlides.length,layout:selectedLayout})});if(!r.ok)throw new Error((await r.json()).message||"렌더링 실패");return URL.createObjectURL(await r.blob());}
async function renderAllSlides(){carouselImageUrls=[];for(var i=0;i<currentSlides.length;i++)carouselImageUrls.push(await renderSlideImage(i));updateCarouselViewer(0);}
function updateCarouselViewer(idx){
    currentSlideIndex=idx;var url=carouselImageUrls[idx];if(!url)return;
    document.getElementById("carouselMainImage").src=url;document.getElementById("slideIndicator").innerText=(idx+1)+" / "+carouselImageUrls.length;
    var grid=document.getElementById("carouselThumbnails");grid.innerHTML="";
    carouselImageUrls.forEach(function(u,i){
        var w=document.createElement("div");w.className="relative slide-thumb"+(i===idx?" active":"");
        var img=document.createElement("img");img.src=u;img.className="w-full aspect-square object-cover rounded-lg";
        var b2=document.createElement("span");b2.className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded font-bold";b2.innerText=i===0?"표지":(i===carouselImageUrls.length-1?"아웃트로":String(i));
        w.onclick=(function(ii){return function(){updateCarouselViewer(ii);populateSlideEditor(ii);};})(i);
        w.appendChild(img);w.appendChild(b2);grid.appendChild(w);
    });
    populateSlideEditor(idx);
}
function navigateSlide(dir){var next=currentSlideIndex+dir;if(next<0)next=carouselImageUrls.length-1;if(next>=carouselImageUrls.length)next=0;updateCarouselViewer(next);}
function populateSlideEditor(idx){
    var s=currentSlides[idx];if(!s){document.getElementById("slideEditorPanel").classList.add("hidden");return;}
    document.getElementById("slideEditorPanel").classList.remove("hidden");
    var labels={cover:"표지 슬라이드",body:"본문 슬라이드 "+(s.step||idx),outro:"아웃트로 슬라이드"};
    document.getElementById("slideEditorLabel").innerText=labels[s.type]||"슬라이드 편집";
    document.getElementById("editTitle").value=s.title||"";document.getElementById("editSubtitle").value=s.subtitle||"";document.getElementById("editContent").value=s.content||"";document.getElementById("editImgKeyword").value=s.imageKeyword||"";
}
function onSlideEdit(){var s=currentSlides[currentSlideIndex];if(!s)return;s.title=document.getElementById("editTitle").value;s.subtitle=document.getElementById("editSubtitle").value;s.content=document.getElementById("editContent").value;s.imageKeyword=document.getElementById("editImgKeyword").value;}
async function reSearchSlideImage(){onSlideEdit();var kw=document.getElementById("editImgKeyword").value||"lifestyle";try{var r=await fetch("/api/search-images?keyword="+encodeURIComponent(kw)),d=await r.json();if(d.success&&d.images&&d.images[0]){currentSlides[currentSlideIndex].imageUrl=d.images[0];await rerenderCurrentSlide();}}catch(e){showError("이미지 재검색 실패: "+e.message);}}
async function rerenderCurrentSlide(){onSlideEdit();try{carouselImageUrls[currentSlideIndex]=await renderSlideImage(currentSlideIndex);updateCarouselViewer(currentSlideIndex);}catch(e){showError("재렌더링 실패: "+e.message);}}
async function downloadCarouselZip(){
    if(!carouselImageUrls.length){showError("먼저 카드뉴스를 생성해주세요.");return;}
    var btn=document.getElementById("zipBtn"),orig=btn.innerHTML;btn.innerHTML="<svg class='spin h-4 w-4 inline' fill='none' viewBox='0 0 24 24'><circle class='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' stroke-width='4'/><path class='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v8z'/></svg> ZIP 생성 중...";btn.disabled=true;
    try{
        var zip=new JSZip(),topic=(document.getElementById("customTopic").value.trim()||selectedTopic||currentCategory).replace(/[\\/\:*?"<>|]/g,"_").substring(0,20),folder=zip.folder(topic+"_카드뉴스");
        for(var i=0;i<carouselImageUrls.length;i++){var resp=await fetch(carouselImageUrls[i]),blob=await resp.blob(),names=["01_표지","02_본문1","03_본문2","04_본문3","05_아웃트로"];folder.file((names[i]||("0"+(i+1)))+".png",blob);}
        folder.file("caption.txt",document.getElementById("carouselCaption").value||"");
        var content=await zip.generateAsync({type:"blob"});saveAs(content,topic+"_카드뉴스.zip");
    }catch(e){showError("ZIP 저장 실패: "+e.message);}
    finally{btn.innerHTML=orig;btn.disabled=false;}
}
function copyCarouselCaption(){var cap=document.getElementById("carouselCaption").value;if(!cap){showError("먼저 카드뉴스를 생성해주세요.");return;}navigator.clipboard.writeText(cap).then(function(){var btn=document.getElementById("copyCarouselBtn"),orig=btn.innerHTML;btn.innerHTML="<i class='fa-solid fa-check'></i> 복사됨!";setTimeout(function(){btn.innerHTML=orig;},2000);});}
</script>
</body>
</html>`;
    res.send(html);
});


app.listen(port, () => console.log(`✅ [인스타그램 AI 크리에이터] 서버 가동 (포트: ${port})`));
