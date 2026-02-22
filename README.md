# Lingo

영어 학습 대화형 봇 + AI 운영 실험.

텔레그램으로 영문 텍스트를 보내면 AI가 독해 가이드를 생성하고, 이어서 질문이나 영작 연습을 대화형으로 진행한다. 동시에 Langfuse와 promptfoo를 활용해 프롬프트 관리, 품질 모니터링, 평가 자동화 등 AI 운영 워크플로우를 실험한다.

## 기능

- 영문 텍스트 또는 URL 전송 → 독해 가이드 생성 (핵심 문장 최대 5개, 끊어 읽기, 구조 해설, 핵심 표현)
- 한국어로 질문하면 학습 중인 텍스트 기반 답변
- "영작 연습" 요청 시 핵심 표현 기반 한→영 영작 문제 출제 + 피드백
- KV로 채팅별 대화 기록 유지 (최근 20턴, 7일 TTL)
- 사용자 피드백(좋아요/아쉬워요) 수집

## AI 운영

- **Langfuse**: 프롬프트 버전 관리, 토큰/비용 추적, 사용자 피드백 점수 기록
- **promptfoo**: 프롬프트 변경 시 회귀 방지 평가 (독해 가이드 형식, 마크다운 미사용 등 자동 검증)

## 구조

```
lingo/
├── worker/                           # Cloudflare Worker
│   ├── src/
│   │   ├── index.js                  # Webhook + 대화 처리 + Gemini 호출
│   │   ├── constants.js              # 상수 + 시스템 프롬프트 import
│   │   └── langfuse.js               # Langfuse REST API 연동
│   ├── prompts/
│   │   └── system-prompt.txt         # 시스템 프롬프트 원본
│   ├── promptfooconfig.yaml          # 프롬프트 평가 설정
│   └── wrangler.toml                 # Worker 설정 + KV 바인딩
└── docs/
    ├── adr/                          # Architecture Decision Records
    └── known-limitations.md
```

## 설정

### 필요한 키
| 키 | 용도 | 발급 방법 |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API | [Google AI Studio](https://aistudio.google.com/apikey)에서 발급 |
| `TELEGRAM_TOKEN` | 텔레그램 봇 토큰 | [@BotFather](https://t.me/BotFather)에서 봇 생성 후 발급 |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram Webhook 검증 토큰 | 임의의 긴 랜덤 문자열 생성 후 사용 |
| `LANGFUSE_PUBLIC_KEY` | Langfuse 모니터링 (선택) | [Langfuse](https://cloud.langfuse.com) 프로젝트 설정에서 발급 |
| `LANGFUSE_SECRET_KEY` | Langfuse 모니터링 (선택) | 위와 동일 |

### 배포
```bash
cd worker
npm install

# KV namespace 생성 후 wrangler.toml의 id를 자신의 값으로 교체
npx wrangler kv namespace create CHAT_HISTORY
# 출력된 id를 wrangler.toml의 [[kv_namespaces]] id에 입력

# 시크릿 등록
echo $GEMINI_API_KEY | npx wrangler secret put GEMINI_API_KEY
echo $TELEGRAM_TOKEN | npx wrangler secret put TELEGRAM_TOKEN
echo $TELEGRAM_WEBHOOK_SECRET | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# 배포
npm run deploy

# Webhook 등록 (WORKER_URL은 배포 후 출력되는 URL)
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url={WORKER_URL}&secret_token={TELEGRAM_WEBHOOK_SECRET}"
```

### 로컬 개발
```bash
# 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 발급받은 키를 입력

# Worker 로컬 실행 (.env를 worker/.dev.vars로 심링크)
ln -s /absolute/path/to/.env worker/.dev.vars
cd worker && npm run dev
```

### 배포 + git push
```bash
# 프로젝트 루트에서 실행. 배포 성공 시에만 git push
./deploy.sh
```

### 프롬프트 평가
```bash
cd worker
npm run eval:all      # 독해/영작 출제/영작 평가 프롬프트 평가 실행
npm run eval:view     # 결과 확인
```

GitHub Actions의 `Prompt Eval` 워크플로우는 `worker/.promptfoo-results/`에 JSON/HTML 결과를 생성하고,
실행 아티팩트(`promptfoo-results-<run_id>`)로 업로드합니다.

## 기술 스택
- Cloudflare Workers + KV
- Gemini 2.0 Flash
- Telegram Bot API
- Langfuse (REST API 직접 호출)
- promptfoo
