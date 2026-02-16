const MAX_TURNS = 20;
const HISTORY_TTL = 60 * 60 * 24; // 24시간

const SYSTEM_PROMPT = `당신은 한국인 영어 학습자를 위한 영어 독해/영작 튜터입니다.

역할:
- 사용자가 영어 아티클이나 긴 영문 텍스트를 보내면 독해 가이드를 작성하세요.
- 사용자가 질문하면 현재 학습 중인 텍스트를 기반으로 답변하세요.
- 사용자가 영작 문장을 보내면 피드백하세요.

독해 가이드 형식:

━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 문장 5개 + 한글 해설]

아티클에서 가장 중요한 영어 문장 5개를 골라 각각 아래 형식으로 분석하세요:

n)
(원문 영어 문장 그대로)

끊어 읽기:
의미 단위마다 줄바꿈으로 끊어서 표기. 슬래시(/) 사용 금지.

한글 해설(의미):
이 문장이 말하고자 하는 바를 자연스러운 한국어로 풀어서 설명.
핵심 개념에는 영어 원어(한글 뜻) 형태로 병기.

구조 해설:
문장에서 배울 만한 문법/구문 패턴을 정리.

━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 표현 5선]

원문에서 실전에 쓸 만한 영어 표현 5개를 뽑아 각각:
표현 — 뜻 — 예문(영어+한국어 번역)

━━━━━━━━━━━━━━━━━━━━━━━━
[영작 퀴즈]

위 핵심 표현 중 하나를 활용한 한->영 번역 퀴즈 1문제.
한국어 문장 제시, 힌트, 모범 답안 포함.

━━━━━━━━━━━━━━━━━━━━━━━━

영작 피드백 규칙:
- 문법 오류가 있으면 교정하고 이유를 설명하세요.
- 더 자연스러운 표현이 있으면 제안하세요.
- 잘 쓴 부분은 칭찬하세요.
- 마지막에 교정된 전체 문장을 보여주세요.
- 사용자가 한국어 문장을 보내면 영작 연습으로 판단하고 영어로 번역한 뒤 핵심 표현을 설명하세요.

절대 하지 말 것:
- 마크다운 문법(**, *, #, \`\`\` 등)을 사용하지 마세요. 순수 텍스트로만 작성하세요.
- 사용자가 요청하지 않은 새로운 과제나 학습 계획을 제시하지 마세요.`;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Missing TELEGRAM_WEBHOOK_SECRET");
      return new Response("Server misconfigured", { status: 500 });
    }

    const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (incomingSecret !== webhookSecret) {
      return new Response("Forbidden", { status: 403 });
    }

    const update = await request.json();
    const message = update.message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = String(message.chat.id);
    const userText = message.text;

    if (userText === "/start") {
      await sendTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        "영어 학습 봇입니다!\n\n영문 텍스트를 보내면 독해 가이드를 생성하고, 이어서 질문이나 영작 연습을 할 수 있습니다."
      );
      return new Response("OK", { status: 200 });
    }

    const history = await loadHistory(env.CHAT_HISTORY, chatId);
    history.push({ role: "user", parts: [{ text: userText }] });

    const reply = await callGemini(env.GEMINI_API_KEY, history);
    history.push({ role: "model", parts: [{ text: reply }] });

    await saveHistory(env.CHAT_HISTORY, chatId, history);
    await sendTelegram(env.TELEGRAM_TOKEN, chatId, reply);

    return new Response("OK", { status: 200 });
  },
};

async function loadHistory(kv, chatId) {
  const data = await kv.get(chatId, "json");
  return data ?? [];
}

async function saveHistory(kv, chatId, history) {
  const trimmed = history.slice(-MAX_TURNS * 2);
  await kv.put(chatId, JSON.stringify(trimmed), { expirationTtl: HISTORY_TTL });
}

async function callGemini(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: history,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("Gemini API error:", err);
    return "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "응답을 생성할 수 없습니다.";
}

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("Telegram API error:", err);
  }
}
