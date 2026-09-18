// 외부 도구(axios)나 .env 파일 없이 가장 확실하게 구글 서버에 직접 물어보는 코드입니다.
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("GEMINI_API_KEY 환경변수가 필요합니다.");
    process.exit(1);
}

async function checkModels() {
    console.log("구글 서버에 모델 목록을 요청합니다...\n");
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        
        console.log("✅ 현재 내 API 키로 쓸 수 있는 정확한 모델명:");
        data.models.forEach(model => {
            if (model.name.includes("flash") || model.name.includes("pro")) {
                console.log(model.name.replace("models/", ""));
            }
        });
    } catch (error) {
        console.log("❌ 에러 발생:", error);
    }
}

checkModels();
