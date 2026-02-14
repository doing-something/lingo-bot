import os
import requests
from bs4 import BeautifulSoup
from google import genai
from dotenv import load_dotenv

load_dotenv()

# ── 환경 변수 ──────────────────────────────────────────────
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

# ── HeyDesigner 최신 글 크롤링 ─────────────────────────────
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_latest_article():
    resp = requests.get("https://heydesigner.com/", timeout=30, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    for li in soup.select("article li"):
        em = li.select_one("em")
        if em and "promoted" in em.get_text():
            continue
        a = li.select_one("a")
        if not a:
            continue
        title = a.get_text(strip=True)
        link = a["href"]
        cite = li.select_one("cite")
        author = cite.get_text(strip=True) if cite else ""
        return title, link, author

    raise RuntimeError("최신 글을 찾을 수 없습니다.")


# ── 아티클 본문 크롤링 ────────────────────────────────────
def fetch_article_body(link, max_chars=10000):
    resp = requests.get(link, timeout=30, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    for tag in soup.select("script, style, nav, header, footer"):
        tag.decompose()

    article = soup.select_one("article") or soup.select_one("main") or soup.body
    text = article.get_text(separator="\n", strip=True) if article else ""
    return text[:max_chars]


# ── Gemini 심층 독해 가이드 생성 ───────────────────────────
def generate_guide(title, link, author, body):
    client = genai.Client(api_key=GEMINI_API_KEY)

    prompt = f"""당신은 영어 디자인 아티클 심층 독해 튜터입니다.
아래 아티클 본문을 읽고, 다음 형식에 맞춰 한국어로 독해 가이드를 작성하세요.

중요: 절대 마크다운 문법(**, *, #, ``` 등)을 사용하지 마세요. 순수 텍스트로만 작성하세요.

━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 문장 5개 + 한글 해설 보강]

아티클에서 가장 중요한 영어 문장 5개를 골라 각각 아래 형식으로 분석하세요:

n)
(원문 영어 문장 그대로)

• 끊어 읽기:
의미 단위마다 줄바꿈으로 끊어서 표기. 슬래시(/) 사용 금지.
예시:
The central question is no longer
whether a system can perform a task,
but how that performance affects
human agency and cognition.

• 한글 해설(의미):
이 문장이 말하고자 하는 바를 자연스러운 한국어로 풀어서 설명.
핵심 개념에는 영어 원어(한글 뜻) 형태로 병기.

• 구조 해설:
문장에서 배울 만한 문법·구문 패턴을 bullet으로 정리.
예) no longer A, but B = 더 이상 A가 아니라 B다

━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 표현 5선]

원문에서 실전에 쓸 만한 영어 표현 5개를 뽑아 각각:
• 표현 — 뜻 — 예문(영어+한국어 번역)

━━━━━━━━━━━━━━━━━━━━━━━━
[영작 퀴즈]

위 핵심 표현 중 하나를 활용한 한→영 번역 퀴즈 1문제.
• 한국어 문장 제시
• 힌트: 사용할 표현과 문장 구조 팁
• 모범 답안 (숨김 표시: 아래에 작성)

━━━━━━━━━━━━━━━━━━━━━━━━
[추가 질문]

이 글의 내용을 더 깊이 이해하기 위한 생각해볼 질문 2개.

━━━━━━━━━━━━━━━━━━━━━━━━

---
제목: {title}
링크: {link}
저자: {author}

본문:
{body}
---"""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
    )
    return response.text


# ── 텔레그램 전송 ──────────────────────────────────────────
def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()


# ── 실행 ───────────────────────────────────────────────────
def main():
    title, link, author = fetch_latest_article()
    body = fetch_article_body(link)
    guide = generate_guide(title, link, author, body)

    msg = (
        f"📖 오늘의 디자인 아티클 독해\n\n"
        f"{title}\n{link}\n\n"
        f"{guide}"
    )
    send_telegram(msg)
    print("전송 완료!")


if __name__ == "__main__":
    main()
