# Lingo

영어 학습 대화형 봇. 텔레그램으로 영문 텍스트를 보내면 AI가 독해 가이드를 생성하고, 이어서 질문이나 영작 연습을 대화형으로 진행한다.

## 구조

```
lingo/
└── worker/                    # Cloudflare Worker (텔레그램 Webhook)
    ├── wrangler.toml          # Worker 설정 + KV 바인딩
    ├── package.json
    └── src/index.js           # 대화형 독해/영작 튜터
```

## 기능

- 영문 텍스트 전송 → 독해 가이드 생성 (핵심 문장 5개, 끊어 읽기, 구조 분석, 영작 퀴즈)
- 이어서 질문하면 맥락 기반 답변
- 영작 문장 전송 → 문법 교정 + 자연스러운 표현 제안
- 한국어 문장 전송 → 영작 번역 + 핵심 표현 설명
- KV로 채팅별 대화 기록 유지 (최근 20턴, 24시간 TTL)

## 설정

### 필요한 키
| 키 | 용도 | 발급 방법 |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API | [Google AI Studio](https://aistudio.google.com/apikey)에서 발급 |
| `TELEGRAM_TOKEN` | 텔레그램 봇 토큰 | [@BotFather](https://t.me/BotFather)에서 봇 생성 후 발급 |

### 배포
```bash
cd worker
npm install

# KV namespace 생성
npx wrangler kv namespace create CHAT_HISTORY
# 출력된 id를 wrangler.toml에 입력

# 시크릿 등록
echo $GEMINI_API_KEY | npx wrangler secret put GEMINI_API_KEY
echo $TELEGRAM_TOKEN | npx wrangler secret put TELEGRAM_TOKEN

# 배포
npm run deploy

# Webhook 등록 (WORKER_URL은 배포 후 출력되는 URL)
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url={WORKER_URL}"
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

## 기술 스택
- Cloudflare Workers + KV
- Gemini API
- Telegram Bot API
