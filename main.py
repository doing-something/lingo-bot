import os
import requests
from bs4 import BeautifulSoup
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# ── 환경 변수 ──────────────────────────────────────────────
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

# ── HeyDesigner 최신 글 크롤링 ─────────────────────────────
def fetch_latest_article():
    resp = requests.get("https://heydesigner.com/", timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    post = soup.select_one("article.post")
    if not post:
        raise RuntimeError("최신 글을 찾을 수 없습니다.")

    title_el = post.select_one("h2 a") or post.select_one("h3 a")
    title = title_el.get_text(strip=True)
    link = title_el["href"]

    snippet_el = post.select_one("p") or post.select_one(".entry-summary")
    snippet = snippet_el.get_text(strip=True) if snippet_el else ""

    return title, link, snippet


# ── Gemini 심층 독해 가이드 생성 ───────────────────────────
def generate_guide(title, link, snippet):
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-pro")

    prompt = f"""당신은 영어 디자인 아티클 독해 튜터입니다.
아래 아티클 정보를 바탕으로 **한국어**로 5~7문장의 심층 독해 가이드를 작성하세요.

가이드에는 반드시 다음을 포함하세요:
1. **핵심 요약** — 글의 주제와 핵심 주장을 1~2문장으로 정리.
2. **끊어 읽기 포인트** — 긴 문장을 의미 단위로 끊어 읽는 팁 1가지.
3. **구조 분석** — 글의 논리 흐름(문제 제기→근거→결론 등)을 한 문장으로 설명.
4. **핵심 표현 5선** — 원문에서 배울 만한 영어 표현 5개와 각각의 뜻·예문.
5. **영작 퀴즈** — 핵심 표현을 활용한 간단한 한→영 번역 퀴즈 1문제.

---
제목: {title}
링크: {link}
발췌: {snippet}
---"""

    response = model.generate_content(prompt)
    return response.text


# ── 텔레그램 전송 ──────────────────────────────────────────
def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown",
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()


# ── 실행 ───────────────────────────────────────────────────
def main():
    title, link, snippet = fetch_latest_article()
    guide = generate_guide(title, link, snippet)

    msg = (
        f"*📖 오늘의 디자인 아티클 독해*\n\n"
        f"*{title}*\n{link}\n\n"
        f"{guide}"
    )
    send_telegram(msg)
    print("전송 완료!")


if __name__ == "__main__":
    main()
