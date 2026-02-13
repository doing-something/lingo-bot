export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const update = await request.json();
    const message = update.message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userText = message.text;

    if (userText === "/start") {
      await sendTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        "영작 문장을 보내주세요. AI가 피드백을 드립니다!"
      );
      return new Response("OK", { status: 200 });
    }

    const feedback = await callGemini(env.GEMINI_API_KEY, userText);
    await sendTelegram(env.TELEGRAM_TOKEN, chatId, feedback);

    return new Response("OK", { status: 200 });
  },
};

async function callGemini(apiKey, userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const prompt = `당신은 한국인 영어 학습자를 위한 영작 피드백 튜터입니다.

사용자가 영어 문장을 보내면:
1. 문법 오류가 있으면 교정하고 이유를 설명하세요.
2. 더 자연스러운 표현이 있으면 제안하세요.
3. 잘 쓴 부분은 칭찬하세요.
4. 마지막에 교정된 전체 문장을 보여주세요.

사용자가 한국어로 보내면:
- 영작 연습을 위한 문장이라고 판단하고, 영어로 번역한 뒤 핵심 표현을 설명하세요.

마크다운 문법(**, *, #, \`\`\` 등)을 사용하지 마세요. 순수 텍스트로만 답변하세요.

사용자 입력:
${userText}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
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
