import os

# main.py가 import 시점에 환경 변수를 읽으므로 먼저 설정
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("TELEGRAM_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_CHAT_ID", "test-chat-id")

from unittest.mock import patch, MagicMock
import pytest

from main import (
    fetch_latest_article,
    fetch_article_body,
    generate_guide,
    send_telegram,
    main,
)


# ── fetch_latest_article ─────────────────────────────────────


HEYDESIGNER_HTML = """
<html><body>
<article>
  <ul>
    <li>
      <em>promoted</em>
      <a href="https://example.com/ad">Ad Article</a>
      <cite>Sponsor</cite>
    </li>
    <li>
      <a href="https://example.com/real">Real Article</a>
      <cite>Author Kim</cite>
    </li>
  </ul>
</article>
</body></html>
"""

ALL_PROMOTED_HTML = """
<html><body>
<article>
  <ul>
    <li>
      <em>promoted</em>
      <a href="https://example.com/ad1">Ad 1</a>
    </li>
    <li>
      <em>promoted</em>
      <a href="https://example.com/ad2">Ad 2</a>
    </li>
  </ul>
</article>
</body></html>
"""


@patch("main.requests.get")
def test_fetch_latest_article_skips_promoted(mock_get):
    """promoted 글을 건너뛰고 첫 번째 일반 글을 반환한다."""
    resp = MagicMock()
    resp.text = HEYDESIGNER_HTML
    mock_get.return_value = resp

    title, link, author = fetch_latest_article()

    assert title == "Real Article"
    assert link == "https://example.com/real"
    assert author == "Author Kim"


@patch("main.requests.get")
def test_fetch_latest_article_all_promoted_raises(mock_get):
    """모든 글이 promoted이면 RuntimeError가 발생한다."""
    resp = MagicMock()
    resp.text = ALL_PROMOTED_HTML
    mock_get.return_value = resp

    with pytest.raises(RuntimeError):
        fetch_latest_article()


# ── fetch_article_body ────────────────────────────────────────


ARTICLE_PAGE_HTML = """
<html>
<head><style>body { color: red; }</style></head>
<body>
<nav>Menu</nav>
<header>Site Header</header>
<article>
  <p>First paragraph of the article.</p>
  <p>Second paragraph with important content.</p>
  <script>alert('xss')</script>
</article>
<footer>Site Footer</footer>
</body>
</html>
"""


@patch("main.requests.get")
def test_fetch_article_body_extracts_text(mock_get):
    """article 태그의 본문을 반환하고 script/style/nav 등은 제거한다."""
    resp = MagicMock()
    resp.text = ARTICLE_PAGE_HTML
    mock_get.return_value = resp

    body = fetch_article_body("https://example.com/article")

    assert "First paragraph" in body
    assert "Second paragraph" in body
    assert "alert" not in body
    assert "Menu" not in body
    assert "Site Header" not in body
    assert "Site Footer" not in body


@patch("main.requests.get")
def test_fetch_article_body_truncates(mock_get):
    """max_chars를 초과하면 잘라서 반환한다."""
    resp = MagicMock()
    resp.text = ARTICLE_PAGE_HTML
    mock_get.return_value = resp

    body = fetch_article_body("https://example.com/article", max_chars=50)

    assert len(body) <= 50


# ── generate_guide ────────────────────────────────────────────


@patch("main.genai.Client")
def test_generate_guide_includes_body_in_prompt(mock_client_cls):
    """Gemini에 전달되는 프롬프트에 body 텍스트가 포함되어야 한다."""
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    mock_response = MagicMock()
    mock_response.text = "가이드 결과"
    mock_client.models.generate_content.return_value = mock_response

    body_text = "This is the actual article body content."
    generate_guide("Test Title", "https://example.com", "Author", body_text)

    call_args = mock_client.models.generate_content.call_args
    prompt = call_args.kwargs.get("contents") or call_args[1].get("contents")
    assert body_text in prompt


# ── send_telegram ─────────────────────────────────────────────


@patch("main.requests.post")
def test_send_telegram_posts_correctly(mock_post):
    """올바른 chat_id와 text로 Telegram API에 POST 요청한다."""
    mock_resp = MagicMock()
    mock_post.return_value = mock_resp

    send_telegram("Hello World")

    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args
    payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
    assert payload["text"] == "Hello World"
    assert payload["chat_id"] == os.environ["TELEGRAM_CHAT_ID"]


# ── main (통합) ───────────────────────────────────────────────


@patch("main.send_telegram")
@patch("main.generate_guide")
@patch("main.fetch_article_body")
@patch("main.fetch_latest_article")
def test_main_integration(mock_fetch, mock_body, mock_guide, mock_send):
    """전체 파이프라인: fetch → body → guide → send 순서로 호출된다."""
    mock_fetch.return_value = ("Title", "https://example.com/a", "Author")
    mock_body.return_value = "Article body text"
    mock_guide.return_value = "Generated guide"

    main()

    mock_fetch.assert_called_once()
    mock_body.assert_called_once_with("https://example.com/a")
    mock_guide.assert_called_once_with("Title", "https://example.com/a", "Author", "Article body text")
    mock_send.assert_called_once()
    sent_msg = mock_send.call_args[0][0]
    assert "Generated guide" in sent_msg
    assert "Title" in sent_msg
