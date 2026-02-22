import { buildIngestionPayload, buildScorePayload, sendToLangfuse, fetchPrompt } from "./langfuse.js";
import {
  MAX_TURNS,
  HISTORY_TTL,
  TELEGRAM_MAX_LEN,
  TELEGRAM_SAFE_LEN,
  MAX_HTML_SIZE,
  MAX_TEXT_LEN,
  SYSTEM_PROMPT,
  feedbackKeyboard,
  nextQuestionKeyboard,
} from "./constants.js";
import type { Env } from "./types.js";

interface GeminiMessage {
  role: string;
  parts: { text: string }[];
}

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface ReplyMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

type WritingQuestionType = "단어" | "구문" | "패턴" | "변환" | "빈칸";

interface WritingState {
  context: string;
  question: string;
  type: WritingQuestionType;
  awaitingAnswer: boolean;
  questionCount: number;
}

interface ChatSessionState {
  history: GeminiMessage[];
  writing: WritingState | null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: any = await request.json();

    if (update.callback_query) {
      const cb = update.callback_query;
      const cbChatId = String(cb.message.chat.id);
      const cbData = String(cb.data ?? "");
      const [action, traceId] = cbData.split(":", 2);

      if (action === "good" || action === "bad") {
        if (traceId && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
          const score = action === "good" ? 1 : 0;
          const payload = buildScorePayload({ traceId, score });
          ctx.waitUntil(sendToLangfuse(env, payload));
        }

        const feedbackText = action === "good" ? "감사합니다!" : "피드백 감사합니다!";
        await Promise.all([
          answerCallbackQuery(env.TELEGRAM_TOKEN, cb.id, feedbackText),
          removeReplyMarkup(env.TELEGRAM_TOKEN, cbChatId, cb.message.message_id),
        ]);
        return new Response("OK", { status: 200 });
      }

      if (action === "next_writing") {
        const session = await loadSession(env.CHAT_HISTORY, cbChatId);
        if (!session.writing?.context) {
          await Promise.all([
            answerCallbackQuery(env.TELEGRAM_TOKEN, cb.id, "먼저 영어 본문이나 URL을 보내주세요."),
            removeReplyMarkup(env.TELEGRAM_TOKEN, cbChatId, cb.message.message_id),
          ]);
          return new Response("OK", { status: 200 });
        }

        await Promise.all([
          answerCallbackQuery(env.TELEGRAM_TOKEN, cb.id, "다음 문제를 준비하고 있어요."),
          removeReplyMarkup(env.TELEGRAM_TOKEN, cbChatId, cb.message.message_id),
        ]);

        const nextType = pickQuestionType(session.writing.questionCount);
        const nextQuestion = await generateWritingQuestion(env.GEMINI_API_KEY, session.writing.context, nextType);

        session.writing.question = nextQuestion;
        session.writing.type = nextType;
        session.writing.awaitingAnswer = true;
        session.writing.questionCount += 1;

        await Promise.all([
          sendTelegram(env.TELEGRAM_TOKEN, cbChatId, formatWritingQuestion(nextType, nextQuestion)),
          saveSession(env.CHAT_HISTORY, cbChatId, session),
        ]);
        return new Response("OK", { status: 200 });
      }

      await answerCallbackQuery(env.TELEGRAM_TOKEN, cb.id, "알 수 없는 요청입니다.");
      return new Response("OK", { status: 200 });
    }

    const message = update.message;
    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = String(message.chat.id);
    const userText: string = message.text;
    const session = await loadSession(env.CHAT_HISTORY, chatId);

    if (userText === "/start") {
      await sendTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        "영어 학습 봇입니다!\n\n영문 텍스트나 URL을 보내면 독해 가이드 후 영작 문제가 자동으로 출제됩니다.\n답안을 보내면 평가 후 다음 질문 버튼으로 이어서 연습할 수 있습니다.\n\n/clear - 대화 초기화"
      );
      return new Response("OK", { status: 200 });
    }

    if (userText === "/clear") {
      await clearSession(env.CHAT_HISTORY, chatId);
      await sendTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        "대화 기록을 초기화했습니다. 새로운 텍스트나 URL을 보내주세요."
      );
      return new Response("OK", { status: 200 });
    }

    const looksLikeNewSource = isUrl(userText) || isLikelyEnglishStudyText(userText);
    if (session.writing?.awaitingAnswer && !looksLikeNewSource) {
      const evaluation = await evaluateWritingAnswer(
        env.GEMINI_API_KEY,
        session.writing.context,
        session.writing.type,
        session.writing.question,
        userText
      );
      session.writing.awaitingAnswer = false;
      await Promise.all([
        sendTelegram(env.TELEGRAM_TOKEN, chatId, evaluation, nextQuestionKeyboard()),
        saveSession(env.CHAT_HISTORY, chatId, session),
      ]);
      return new Response("OK", { status: 200 });
    }
    if (session.writing?.awaitingAnswer && looksLikeNewSource) {
      session.writing.awaitingAnswer = false;
    }

    let textForAI = userText;
    let wasTruncated = false;
    let isSourceInput = false;

    if (isUrl(userText)) {
      const result = await fetchArticle(userText.trim());
      if (!result) {
        await sendTelegram(env.TELEGRAM_TOKEN, chatId, "URL에서 글을 가져올 수 없습니다.");
        return new Response("OK", { status: 200 });
      }
      textForAI = result.text;
      wasTruncated = result.truncated;
      isSourceInput = true;
    } else if (userText.length > MAX_TEXT_LEN) {
      textForAI = truncateText(userText, MAX_TEXT_LEN);
      wasTruncated = true;
      isSourceInput = isLikelyEnglishStudyText(userText);
    } else {
      isSourceInput = isLikelyEnglishStudyText(userText);
    }

    const langfuseEnabled = env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY;
    const [history, fetched] = await Promise.all([
      Promise.resolve(session.history),
      langfuseEnabled ? fetchPrompt(env, "system-prompt") : null,
    ]);

    let promptVersion: number | null = null;
    let systemPrompt = SYSTEM_PROMPT;
    if (fetched) {
      systemPrompt = fetched.prompt;
      promptVersion = fetched.version;
    }
    history.push({ role: "user", parts: [{ text: textForAI }] });

    const startTime = new Date().toISOString();
    const geminiResult = await callGemini(env.GEMINI_API_KEY, history, systemPrompt);
    const endTime = new Date().toISOString();
    history.push({ role: "model", parts: [{ text: geminiResult.text }] });

    session.history = history;

    const traceId = crypto.randomUUID();

    if (wasTruncated) {
      await sendTelegram(env.TELEGRAM_TOKEN, chatId, "(텍스트가 길어 앞부분만 분석합니다)");
    }
    await sendTelegram(env.TELEGRAM_TOKEN, chatId, geminiResult.text, feedbackKeyboard(traceId));

    if (isSourceInput) {
      const startIndex = randomQuestionIndex();
      const questionType = pickQuestionType(startIndex);
      const question = await generateWritingQuestion(env.GEMINI_API_KEY, geminiResult.text, questionType);
      session.writing = {
        context: geminiResult.text,
        question,
        type: questionType,
        awaitingAnswer: true,
        questionCount: startIndex + 1,
      };
      await sendTelegram(env.TELEGRAM_TOKEN, chatId, formatWritingQuestion(questionType, question));
    }

    await saveSession(env.CHAT_HISTORY, chatId, session);

    if (langfuseEnabled) {
      const payload = buildIngestionPayload({
        traceId,
        generationId: crypto.randomUUID(),
        chatId,
        input: textForAI,
        output: geminiResult.text,
        usage: geminiResult.usage,
        startTime,
        endTime,
        promptName: promptVersion ? "system-prompt" : undefined,
        promptVersion,
      });
      ctx.waitUntil(sendToLangfuse(env, payload));
    }

    return new Response("OK", { status: 200 });
  },
} satisfies ExportedHandler<Env>;

async function loadSession(kv: KVNamespace, chatId: string): Promise<ChatSessionState> {
  const data = await kv.get(chatId, "json") as unknown;
  if (!data) {
    return { history: [], writing: null };
  }
  if (Array.isArray(data)) {
    return { history: data as GeminiMessage[], writing: null };
  }
  if (typeof data === "object" && data !== null) {
    const record = data as { history?: unknown; writing?: unknown };
    const history = Array.isArray(record.history) ? record.history as GeminiMessage[] : [];
    const writing = normalizeWritingState(record.writing);
    return { history, writing };
  }
  return { history: [], writing: null };
}

async function clearSession(kv: KVNamespace, chatId: string): Promise<void> {
  await kv.delete(chatId);
}

async function saveSession(kv: KVNamespace, chatId: string, session: ChatSessionState): Promise<void> {
  const payload: ChatSessionState = {
    history: session.history.slice(-MAX_TURNS * 2),
    writing: session.writing,
  };
  await kv.put(chatId, JSON.stringify(payload), { expirationTtl: HISTORY_TTL });
}

function normalizeWritingState(raw: unknown): WritingState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.context !== "string" || typeof data.question !== "string") return null;
  if (typeof data.awaitingAnswer !== "boolean" || typeof data.questionCount !== "number") return null;
  const type = data.type;
  if (!isWritingType(type)) return null;
  return {
    context: data.context,
    question: data.question,
    type,
    awaitingAnswer: data.awaitingAnswer,
    questionCount: data.questionCount,
  };
}

function isWritingType(value: unknown): value is WritingQuestionType {
  return value === "단어" || value === "구문" || value === "패턴" || value === "변환" || value === "빈칸";
}

async function callGemini(apiKey: string, history: GeminiMessage[], systemPrompt: string): Promise<{ text: string; usage: GeminiUsage | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await resp.json();
  const usage: GeminiUsage | null = data.usageMetadata ?? null;
  const candidate = data.candidates?.[0];
  if (!candidate) {
    console.error("Gemini: no candidates", JSON.stringify(data));
    return { text: "응답을 생성할 수 없습니다.", usage };
  }
  if (candidate.finishReason === "SAFETY") {
    return { text: "안전 필터에 의해 응답이 차단되었습니다. 다른 텍스트로 시도해주세요.", usage };
  }
  let text: string = candidate.content?.parts?.[0]?.text ?? "응답을 생성할 수 없습니다.";
  if (candidate.finishReason === "MAX_TOKENS") {
    text += "\n\n(응답이 길어 일부가 잘렸습니다)";
  }
  return { text, usage };
}

async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
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

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}

export function isLikelyEnglishStudyText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const hangul = (trimmed.match(/[가-힣]/g) ?? []).length;
  return latin >= 8 && latin >= hangul * 2;
}

export function pickQuestionType(index: number): WritingQuestionType {
  const cycle: WritingQuestionType[] = ["단어", "구문", "패턴", "변환", "빈칸"];
  return cycle[index % cycle.length];
}

function randomQuestionIndex(): number {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return seed % 5;
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(".", maxLen);
  if (cut > maxLen * 0.5) return text.slice(0, cut + 1);
  const spaceCut = text.lastIndexOf(" ", maxLen);
  return spaceCut > 0 ? text.slice(0, spaceCut) : text.slice(0, maxLen);
}

export function extractMainContent(html: string): string {
  const articleMatch = html.match(/<article[\s>][\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];

  const mainMatch = html.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];

  return html;
}

async function fetchArticle(url: string): Promise<{ text: string; truncated: boolean } | null> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LingoBot/1.0)" },
    redirect: "follow",
  });
  if (!resp.ok) return null;

  const rawHtml = await readLimited(resp.body!, MAX_HTML_SIZE);
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

async function generateWritingQuestion(apiKey: string, context: string, type: WritingQuestionType): Promise<string> {
  const systemPrompt = "당신은 한국인 영어 학습자를 위한 영작 문제 출제 튜터입니다. 한국어로 명확하고 간결하게 작성하세요.";
  const prompt = `아래 학습 맥락을 기반으로 ${type} 중심의 영작 문제 1개를 출제하세요.

요구사항:
- 출력은 반드시 순수 텍스트
- 문제 문장(한국어) 1개
- 학습 힌트 1줄
- 정답 예시는 포함하지 말 것

[학습 맥락]
${context}`;

  const result = await callGemini(
    apiKey,
    [{ role: "user", parts: [{ text: prompt }] }],
    systemPrompt
  );
  return result.text;
}

async function evaluateWritingAnswer(
  apiKey: string,
  context: string,
  type: WritingQuestionType,
  question: string,
  userAnswer: string
): Promise<string> {
  const systemPrompt = "당신은 한국인 영어 학습자의 영작 답안을 평가하는 튜터입니다. 정중하고 구체적으로 피드백하세요.";
  const prompt = `아래 정보를 바탕으로 답안을 평가하세요.

출력 형식:
1) 평가 요약(좋은 점/개선점)
2) 수정 제안(필요 시)
3) 모범 답안 1개
4) 핵심 포인트 1줄

유형: ${type}
문제:
${question}

학습 맥락:
${context}

학습자 답안:
${userAnswer}`;

  const result = await callGemini(
    apiKey,
    [{ role: "user", parts: [{ text: prompt }] }],
    systemPrompt
  );
  return result.text;
}

function formatWritingQuestion(type: WritingQuestionType, question: string): string {
  return `[자동 영작 연습]\n유형: ${type}\n\n${question}\n\n답안을 영어로 보내주세요.`;
}

async function answerCallbackQuery(token: string, callbackQueryId: string, text: string): Promise<void> {
  const resp = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  if (!resp.ok) {
    console.error(`answerCallbackQuery error (${resp.status}):`, await resp.text());
  }
}

async function removeReplyMarkup(token: string, chatId: string, messageId: number): Promise<void> {
  const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
  });
  if (!resp.ok) {
    console.error(`removeReplyMarkup error (${resp.status}):`, await resp.text());
  }
}

async function sendTelegram(token: string, chatId: string, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = splitTelegramMessage(text, TELEGRAM_SAFE_LEN);
  const total = chunks.length;

  for (let i = 0; i < total; i += 1) {
    const prefix = total > 1 ? `(${i + 1}/${total})\n` : "";
    const chunkText = `${prefix}${chunks[i]}`.slice(0, TELEGRAM_MAX_LEN);
    const isLast = i === total - 1;
    const body: Record<string, unknown> = { chat_id: chatId, text: chunkText };
    if (isLast && replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Telegram API error (chunk ${i + 1}/${total}):`, err);
      break;
    }
  }
}

export function splitTelegramMessage(text: unknown, maxLen: number): string[] {
  const source = String(text ?? "");
  if (source.length <= maxLen) {
    return [source];
  }

  const chunks: string[] = [];
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
