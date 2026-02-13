# Lingo

영어 학습 자동화 도구. AI가 매일 아침 디자인 아티클 독해 가이드를 보내고, 사용자의 영작에 실시간 피드백한다.

## 구조

```
lingo/
├── main.py                           # 일방향: 아티클 크롤링 → 독해 가이드 생성 → 텔레그램 전송
├── .github/workflows/daily_tutor.yml # GitHub Actions (매일 KST 08:00)
├── requirements.txt
└── worker/                           # 양방향: 텔레그램 메시지 → AI 영작 피드백
    ├── wrangler.toml
    ├── package.json
    └── src/index.js                  # Cloudflare Worker (Webhook)
```

## 기능

### 독해 가이드 (일방향)
- HeyDesigner 최신 글 크롤링
- Gemini로 심층 독해 가이드 생성 (핵심 문장 5개, 끊어 읽기, 구조 분석, 영작 퀴즈)
- 텔레그램으로 매일 아침 자동 전송

### 영작 피드백 (양방향)
- 텔레그램에서 영어 문장 전송 → 문법 교정 + 자연스러운 표현 제안
- 한국어 문장 전송 → 영작 번역 + 핵심 표현 설명

## 설정

### 필요한 키
| 키 | 용도 |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API |
| `TELEGRAM_TOKEN` | 텔레그램 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 텔레그램 채팅 ID (일방향 전송용) |

### 독해 가이드 (GitHub Actions)
1. GitHub 리포지토리 Settings → Secrets에 위 3개 키 등록
2. 매일 KST 08:00 자동 실행, Actions 탭에서 수동 실행도 가능

### 영작 피드백 (Cloudflare Worker)
```bash
cd worker
npm install

# 시크릿 등록
echo $GEMINI_API_KEY | npx wrangler secret put GEMINI_API_KEY
echo $TELEGRAM_TOKEN | npx wrangler secret put TELEGRAM_TOKEN

# 배포
npm run deploy

# Webhook 등록 (WORKER_URL은 배포 후 출력되는 URL)
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url={WORKER_URL}"
```

### 로컬 테스트
```bash
# 루트에 .env 파일 생성
GEMINI_API_KEY=...
TELEGRAM_TOKEN=...
TELEGRAM_CHAT_ID=...

# Worker 로컬 실행 (.env를 worker/.dev.vars로 심링크)
ln -s /absolute/path/to/.env worker/.dev.vars
cd worker && npm run dev
```

## 기술 스택
- Python, BeautifulSoup, google-generativeai
- Cloudflare Workers, Gemini API
- Telegram Bot API, GitHub Actions
