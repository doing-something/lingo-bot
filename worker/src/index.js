const MAX_TURNS = 20;
const HISTORY_TTL = 60 * 60 * 24 * 7; // 7일
const TELEGRAM_MAX_LEN = 4096;
const TELEGRAM_SAFE_LEN = 3900;
const MAX_HTML_SIZE = 512 * 1024; // 512KB
const MAX_TEXT_LEN = 10000;

const SYSTEM_PROMPT = `당신은 한국인 영어 학습자를 위한 영어 독해/영작 튜터입니다.

역할:
- 사용자가 영어 아티클이나 긴 영문 텍스트를 보내면 독해 가이드를 작성하세요.
- 사용자가 질문하면 현재 학습 중인 텍스트를 기반으로 답변하세요.
- 사용자가 영작 문장을 보내면 피드백하세요.

새 아티클 vs 후속 메시지 판단 기준:
- 3문장 이상의 영문 텍스트가 오면 새 아티클로 판단하고 독해 가이드를 작성하세요.
- 1~2문장의 짧은 영문이나 한국어 메시지는 이전 대화의 후속 질문 또는 영작 연습으로 판단하세요.
- 대화 기록이 비어 있으면 어떤 입력이든 새 학습으로 시작하세요.

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
        "영어 학습 봇입니다!\n\n영문 텍스트나 URL을 보내면 독해 가이드를 생성하고, 이어서 질문이나 영작 연습을 할 수 있습니다.\n\n/clear - 대화 초기화"
      );
      return new Response("OK", { status: 200 });
    }

    if (userText === "/clear") {
      await env.CHAT_HISTORY.delete(chatId);
      await sendTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        "대화 기록을 초기화했습니다. 새로운 텍스트나 URL을 보내주세요."
      );
      return new Response("OK", { status: 200 });
    }

    let textForAI = userText;
    let wasTruncated = false;

    if (isUrl(userText)) {
      const result = await fetchArticle(userText.trim());
      if (!result) {
        await sendTelegram(env.TELEGRAM_TOKEN, chatId, "URL에서 글을 가져올 수 없습니다.");
        return new Response("OK", { status: 200 });
      }
      textForAI = result.text;
      wasTruncated = result.truncated;
    } else if (userText.length > MAX_TEXT_LEN) {
      textForAI = truncateText(userText, MAX_TEXT_LEN);
      wasTruncated = true;
    }

    const history = await loadHistory(env.CHAT_HISTORY, chatId);
    history.push({ role: "user", parts: [{ text: textForAI }] });

    const geminiResult = await callGemini(env.GEMINI_API_KEY, history);
    history.push({ role: "model", parts: [{ text: geminiResult.text }] });

    await saveHistory(env.CHAT_HISTORY, chatId, history);
    if (wasTruncated) {
      await sendTelegram(env.TELEGRAM_TOKEN, chatId, "(텍스트가 길어 앞부분만 분석합니다)");
    }
    await sendTelegram(env.TELEGRAM_TOKEN, chatId, geminiResult.text);

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
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Gemini API error (${resp.status}):`, err);
    if (resp.status === 429) {
      return { text: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", usage: null };
    }
    if (resp.status === 400) {
      return { text: "텍스트가 너무 길거나 처리할 수 없는 내용입니다. 더 짧은 텍스트로 시도해주세요.", usage: null };
    }
    return { text: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해주세요.", usage: null };
  }

  const data = await resp.json();
  const usage = data.usageMetadata ?? null;
  const candidate = data.candidates?.[0];
  if (!candidate) {
    console.error("Gemini: no candidates", JSON.stringify(data));
    return { text: "응답을 생성할 수 없습니다.", usage };
  }
  if (candidate.finishReason === "SAFETY") {
    return { text: "안전 필터에 의해 응답이 차단되었습니다. 다른 텍스트로 시도해주세요.", usage };
  }
  let text = candidate.content?.parts?.[0]?.text ?? "응답을 생성할 수 없습니다.";
  if (candidate.finishReason === "MAX_TOKENS") {
    text += "\n\n(응답이 길어 일부가 잘렸습니다)";
  }
  return { text, usage };
}

async function readLimited(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    chunks.push(remaining < value.length ? value.slice(0, remaining) : value);
    total += value.length;
  }

  reader.releaseLock();
  return new TextDecoder().decode(concatUint8(chunks));
}

function concatUint8(arrays) {
  const len = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

export function isUrl(text) {
  return /^https?:\/\/\S+$/.test(text.trim());
}

export function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(".", maxLen);
  if (cut > maxLen * 0.5) return text.slice(0, cut + 1);
  const spaceCut = text.lastIndexOf(" ", maxLen);
  return spaceCut > 0 ? text.slice(0, spaceCut) : text.slice(0, maxLen);
}

export function extractMainContent(html) {
  const articleMatch = html.match(/<article[\s>][\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];

  const mainMatch = html.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];

  return html;
}

async function fetchArticle(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LingoBot/1.0)" },
    redirect: "follow",
  });
  if (!resp.ok) return null;

  const rawHtml = await readLimited(resp.body, MAX_HTML_SIZE);
  const html = extractMainContent(rawHtml);
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec)))
    .replace(/\s+/g, " ")
    .trim();

  const truncated = text.length > MAX_TEXT_LEN;
  if (truncated) {
    text = truncateText(text, MAX_TEXT_LEN);
  }

  return text ? { text, truncated } : null;
}

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = splitTelegramMessage(text, TELEGRAM_SAFE_LEN);
  const total = chunks.length;

  for (let i = 0; i < total; i += 1) {
    const prefix = total > 1 ? `(${i + 1}/${total})\n` : "";
    const chunkText = `${prefix}${chunks[i]}`.slice(0, TELEGRAM_MAX_LEN);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunkText }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Telegram API error (chunk ${i + 1}/${total}):`, err);
      break;
    }
  }
}

export function splitTelegramMessage(text, maxLen) {
  const source = String(text ?? "");
  if (source.length <= maxLen) {
    return [source];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const hardEnd = Math.min(cursor + maxLen, source.length);
    if (hardEnd === source.length) {
      chunks.push(source.slice(cursor));
      break;
    }

    const window = source.slice(cursor, hardEnd);
    const minBreakPos = Math.floor(maxLen * 0.4);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    ];

    let breakPos = -1;
    for (const pos of candidates) {
      if (pos >= minBreakPos) {
        breakPos = pos;
        break;
      }
    }

    const end = breakPos >= 0 ? cursor + breakPos + 1 : hardEnd;
    const chunk = source.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    cursor = end;
  }

  return chunks.length > 0 ? chunks : [source.slice(0, maxLen)];
}
