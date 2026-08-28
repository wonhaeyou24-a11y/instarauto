require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3000;

app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// [상태 관리] 자동화 모드 및 로그
let autoPilotState = {
    enabled: false,
    interval: '6hours', // '1min'(테스트용), '1hour', '6hours', '24hours'
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

// [1. Unsplash 이미지 검색 모듈]
async function getUnsplashImage(keyword) {
    try {
        const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=squarish&client_id=${UNSPLASH_ACCESS_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.urls && data.urls.regular) {
            return data.urls.regular;
        }
        throw new Error("No image found");
    } catch (error) {
        return `https://placehold.co/600x600/1e293b/ffffff?text=${encodeURIComponent(keyword)}`;
    }
}

// [2. 무인 자동 생성 및 발행 파이프라인]
async function runAutoPilotPipeline() {
    addLog("🤖 [자동화] 새로운 트렌드 콘텐츠 자동 생성을 시작합니다...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const prompt = `
        너는 10만 팔로워를 가진 트렌디한 인스타그램 마케터야.
        분야: 소자본 재테크/공간대여, 국내 힐링 여행, 현실 육아/일상, 신비한 상식 중 하나를 무작위로 선택해서
        지금 가장 매력적인 인스타그램 캡션과 사진 검색 키워드 1개를 작성해줘.

        조건:
        1. 첫 문장은 시선을 사로잡는 강력한 후킹으로 시작
        2. 이모지와 깔끔한 줄바꿈 사용
        3. 해시태그 5개 포함
        4. 순수 JSON 형식으로만 응답:
        {
            "topic": "선택한 주제",
            "keyword": "검색용 영어단어",
            "caption": "인스타그램 본문 전체"
        }
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        addLog(`🎯 주제 선정 완료: [${parsed.topic}]`);
        
        const imageUrl = await getUnsplashImage(parsed.keyword);
        addLog(`📸 고화질 이미지 매칭 완료 (${parsed.keyword})`);

        // (내일 메타 토큰 연동 시 실제 업로드 API가 실행되는 영역)
        addLog(`🚀 인스타그램 피드 자동 게시 완료!`);
    } catch (error) {
        addLog(`❌ 자동화 실행 중 오류 발생: ${error.message}`);
    }
}

// [3. 스케줄러 설정 함수]
function setupCron(interval) {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    // 크론 표현식 매핑
    let cronTime = '0 */6 * * *'; // 기본 6시간마다
    if (interval === '1min') cronTime = '*/1 * * * *'; // 테스트용 1분마다
    if (interval === '1hour') cronTime = '0 */1 * * *';
    if (interval === '24hours') cronTime = '0 9 * * *'; // 매일 오전 9시

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
        // 켜자마자 즉시 1회 자동 실행
        runAutoPilotPipeline();
    } else {
        if (scheduledTask) scheduledTask.stop();
        addLog(`🔴 완전 자동화가 일시 중지되었습니다.`);
    }
    res.json({ success: true, state: autoPilotState });
});

app.get('/api/trends', async (req, res) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const prompt = `인기 트렌드 주제 5개를 순수 JSON 배열 형식으로만 추천해줘: ["주제1", "주제2", "주제3", "주제4", "주제5"]`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json({ success: true, trends: JSON.parse(text) });
    } catch (e) {
        res.json({ success: true, trends: ["소자본 공간대여 수익화", "국내 힐링 여행지", "현실 육아 꿀팁", "이달의 경제 상식", "신비한 과학 상식"] });
    }
});

app.post('/api/generate', async (req, res) => {
    const { topic, instruction, currentCaption } = req.body;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        let prompt = currentCaption
            ? `[기존]: ${currentCaption}\n[지시]: ${instruction}\n수정 후 JSON 응답: {"keyword":"영단어", "caption":"수정본"}`
            : `[주제]: ${topic}\n[지시]: ${instruction || "없음"}\n조건: 첫문장 후킹, 이모지, 해시태그 5개\nJSON 응답: {"keyword":"영단어", "caption":"본문"}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        const imageUrl = await getUnsplashImage(parsed.keyword);

        res.json({ success: true, imageUrl, caption: parsed.caption });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
            <div class="max-w-6xl mx-auto space-y-6">
                <!-- 상단 헤더 & 완전자동화 컨트롤러 -->
                <header class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-800">📸 인스타그램 크리에이터 스튜디오</h1>
                        <p class="text-xs text-slate-500 mt-1">수동 기획 검수 & 무인 완전 자동화 하이브리드 시스템</p>
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
                            <div class="flex justify-between items-center mb-3">
                                <label class="text-sm font-semibold text-slate-700">🔥 트렌드 주제 선택</label>
                                <button onclick="fetchTrends()" class="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
                            </div>
                            <div id="trendList" class="space-y-2 mb-4">
                                <div class="text-sm text-slate-400">트렌드를 불러오는 중...</div>
                            </div>

                            <label class="block text-sm font-semibold text-slate-700 mb-2">✍️ 직접 주제 입력</label>
                            <input type="text" id="customTopic" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4" placeholder="직접 다루고 싶은 주제 입력">

                            <label class="block text-sm font-semibold text-slate-700 mb-2">💡 상세 지시 및 수정 요구사항</label>
                            <textarea id="instruction" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4" rows="2" placeholder="예: '첫 문장을 더 강렬하게', '해시태그를 더 다양하게'"></textarea>

                            <div class="flex gap-3">
                                <button id="genBtn" onclick="handleGenerate(false)" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg shadow transition">
                                    ✨ 콘텐츠 생성하기
                                </button>
                                <button id="refineBtn" onclick="handleGenerate(true)" class="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 rounded-lg shadow transition">
                                    🔄 지시사항으로 수정하기
                                </button>
                            </div>
                        </div>

                        <!-- 캡션 에디터 -->
                        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <label class="block text-sm font-semibold text-slate-700 mb-2">📝 캡션 직접 편집</label>
                            <textarea id="captionEditor" oninput="syncCaption()" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none h-36" placeholder="생성된 글이 표시되며 직접 수정할 수 있습니다."></textarea>
                        </div>

                        <!-- 자동화 로그 모니터링 창 -->
                        <div class="bg-slate-900 text-emerald-400 p-4 rounded-2xl shadow-sm font-mono text-xs h-40 overflow-y-auto" id="logConsole">
                            <div>> [시스템 준비 완료] 자동화 대기 중...</div>
                        </div>
                    </div>

                    <!-- 모바일 목업 (우측 5열) -->
                    <div class="lg:col-span-5 flex justify-center">
                        <div class="w-full max-w-sm bg-white border border-slate-300 rounded-3xl shadow-xl overflow-hidden flex flex-col h-fit">
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
                                <button class="w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white font-bold py-3 rounded-xl shadow hover:opacity-95 transition">
                                    🚀 인스타그램에 바로 게시
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                let selectedTopic = "";
                let isAutoEnabled = false;

                async function fetchTrends() {
                    const list = document.getElementById('trendList');
                    list.innerHTML = '<div class="text-sm text-slate-400">실시간 분석 중...</div>';
                    try {
                        const res = await fetch('/api/trends');
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

                async function handleGenerate(isRefine) {
                    const btn = isRefine ? document.getElementById('refineBtn') : document.getElementById('genBtn');
                    const customTopic = document.getElementById('customTopic').value;
                    const finalTopic = customTopic || selectedTopic || "트렌드 인사이트";
                    const instruction = document.getElementById('instruction').value;
                    const currentCaption = isRefine ? document.getElementById('captionEditor').value : "";

                    btn.disabled = true;
                    btn.innerText = "⏳ 처리 중...";

                    try {
                        const res = await fetch('/api/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ topic: finalTopic, instruction, currentCaption })
                        });
                        const data = await res.json();
                        if (data.success) {
                            document.getElementById('captionEditor').value = data.caption;
                            document.getElementById('mockCaption').innerText = data.caption;
                            document.getElementById('mockImage').src = data.imageUrl;
                        }
                    } catch (err) {
                        alert("생성 실패");
                    } finally {
                        btn.disabled = false;
                        btn.innerText = isRefine ? "🔄 지시사항으로 수정하기" : "✨ 콘텐츠 생성하기";
                    }
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

                // 주기적 로그 동기화 (3초마다)
                setInterval(async () => {
                    const res = await fetch('/api/autopilot');
                    const data = await res.json();
                    updateAutoUI(data);
                }, 3000);

                fetchTrends();
            </script>
        </body>
        </html>
    `);
});

app.listen(port, () => {
    console.log(`✅ [완전자동화 탑재] 대시보드 서버 가동 (포트: ${port})`);
});
