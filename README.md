# instarauto

Node + Express 기반 인스타그램 콘텐츠 자동 생성/예약 발행 웹앱입니다.

## 로컬 실행

```bash
npm install
PORT=3000 HOST=0.0.0.0 node index.js
```

브라우저에서 다음 주소로 접속합니다:

```text
http://127.0.0.1:3000
```

## 배포

이 프로젝트는 Render, Railway 같은 Node 서버 호스팅 서비스에 배포하는 것을 권장합니다.

### Render 예시
- Build Command: `npm install`
- Start Command: `npm start`
- 환경 변수 추가: 기존 [.env](.env) 값 그대로 입력

## 환경 변수

기존 [.env](.env) 파일에 실제 값이 이미 있으므로, 배포 환경에서는 같은 키를 그대로 설정하면 됩니다.

필수 키 예시:
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `UNSPLASH_ACCESS_KEY`
- `IG_USER_ID`
- `IG_ACCESS_TOKEN`
- `KAKAO_CLIENT_ID`
- `KAKAO_REFRESH_TOKEN`
- `PUBLIC_BASE_URL`
- `PORT`
- `HOST`

## GitHub 업로드

```bash
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```