# Instagram Creator Studio

AI로 인스타그램 캡션과 카드뉴스를 만들고, 편집·보관·다운로드하는 로컬 도구입니다. 인스타그램 계정에 자동 게시하거나 예약 게시하지 않습니다.

## 실행

`npm start` 후 브라우저에서 `http://localhost:3000`을 엽니다.

Google Gemini 또는 OpenAI를 고르고 API 키를 입력한 다음 **모델 불러오기**를 누르세요. API 키는 요청 처리에만 쓰이며 `.env`나 `posts.json`에 저장되지 않습니다.

카드뉴스는 슬라이드 문구를 바로 고치고, 이미지 검색 키워드를 바꿔 해당 장만 재검색할 수 있습니다. 생성물은 보관함에 저장하고 PNG/ZIP으로 내려받거나 캡션과 해시태그를 한 번에 복사해 인스타그램 앱에 붙여넣을 수 있습니다.

## GitHub · Render 배포

이 프로젝트는 Node 서버와 이미지 렌더링을 사용하므로 GitHub Pages 같은 정적 호스팅에는 배포할 수 없습니다. 저장한 초안과 카드뉴스 이미지가 재배포 뒤에도 남도록 [Render](https://render.com)의 웹 서비스와 지속 디스크를 사용하도록 `render.yaml`을 포함했습니다.

1. 이 저장소를 GitHub에 push합니다.
2. Render에서 **New + → Blueprint**를 선택하고 GitHub 저장소를 연결합니다.
3. `render.yaml`을 선택해 생성한 뒤, Render의 환경 변수에 `UNSPLASH_ACCESS_KEY`를 입력합니다. 이 값은 선택 사항이며 없으면 기본 이미지가 사용됩니다.
4. 배포가 완료되면 Render가 제공하는 URL을 엽니다.

AI API 키는 사용자가 브라우저 화면에서 직접 입력하며 서버의 환경 변수나 보관함에 저장되지 않습니다. 현재 보관함을 유지하려면 `starter` 플랜과 지속 디스크가 필요합니다. Render의 기본 파일시스템은 재시작·재배포 시 초기화되므로 무료 무상태 플랜에는 저장 기능이 맞지 않습니다.
# instarauto
