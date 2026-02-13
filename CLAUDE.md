# CLAUDE.md

## 프로젝트 개요
영어 학습 자동화 봇. 두 개의 독립적인 컴포넌트로 구성:
- `main.py`: GitHub Actions로 실행되는 일방향 독해 가이드 전송 (Python)
- `worker/`: Cloudflare Worker 기반 양방향 영작 피드백 봇 (JavaScript)

## 핵심 규칙
- 텔레그램 메시지에 마크다운 문법 사용 금지 (순수 텍스트만)
- 시크릿은 절대 코드에 하드코딩하지 않음
- `main.py`의 Gemini 모델: `gemini-2.0-flash`
- `worker/src/index.js`의 Gemini 모델: `gemini-2.0-flash`

## 빌드/실행
- Python: `pip install -r requirements.txt && python main.py`
- Worker 로컬: `cd worker && npm install && npm run dev`
- Worker 배포: `cd worker && npm run deploy`

## 환경 변수
- `GEMINI_API_KEY`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`
- Worker 로컬 개발: `worker/.dev.vars` (루트 `.env` 심링크)
- Worker 배포: `wrangler secret put`으로 등록

## 파일 구조
- `main.py` — 크롤링 + 가이드 생성 + 텔레그램 전송 (단일 파일)
- `worker/src/index.js` — Webhook 수신 + Gemini 호출 + 텔레그램 답장 (단일 파일)
- 두 컴포넌트는 독립적이며 코드를 공유하지 않음
