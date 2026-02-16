# CLAUDE.md

## 프로젝트 개요
영어 학습 대화형 봇. Cloudflare Worker 기반.
- 사용자가 텔레그램으로 영문 텍스트를 보내면 독해 가이드 생성
- 이어서 질문, 영작 연습 등 대화형 학습 가능
- KV로 채팅별 대화 기록 유지

## 핵심 규칙
- 텔레그램 메시지에 마크다운 문법 사용 금지 (순수 텍스트만)
- 시크릿은 절대 코드에 하드코딩하지 않음
- Gemini 모델: `gemini-2.0-flash`

## 빌드/실행
- Worker 로컬: `cd worker && npm install && npm run dev`
- Worker 배포: `cd worker && npm run deploy`
- 프롬프트 평가: `cd worker && npm run eval` (결과 확인: `npm run eval:view`)

## 환경 변수
- `GEMINI_API_KEY`, `TELEGRAM_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (LLM 모니터링, BASE_URL 기본값: `https://us.cloud.langfuse.com`)
- KV namespace: `CHAT_HISTORY` (wrangler.toml에 바인딩)
- Worker 로컬 개발: `worker/.dev.vars` (루트 `.env` 심링크)
- Worker 배포: `wrangler secret put`으로 등록

## 파일 구조
- `worker/src/index.js` — Webhook 수신 + KV 대화 기록 + Gemini 멀티턴 호출 + 텔레그램 답장
- `worker/src/constants.js` — 시스템 프롬프트(폴백), 상수
- `worker/prompts/system-prompt.txt` — 시스템 프롬프트 원본 (promptfoo 평가 대상)
- `worker/promptfooconfig.yaml` — promptfoo 평가 설정 + 테스트 케이스
- `worker/wrangler.toml` — Worker 설정 + KV 바인딩
