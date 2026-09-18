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

app.listen(port, () => console.log(`✅ [인스타그램 AI 크리에이터] 서버 가동 (포트: ${port})`));
