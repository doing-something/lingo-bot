/**
 * Langfuse POST /api/public/ingestion 에 보낼 batch payload를 조립한다.
 * trace-create 1개 + generation-create 1개로 구성.
 *
 * @param {Object} params
 * @param {string} params.traceId - Trace 식별자 (UUID)
 * @param {string} params.generationId - Generation 식별자 (UUID)
 * @param {string} params.chatId - 텔레그램 채팅 ID (Langfuse userId로 기록)
 * @param {string} params.input - 사용자 입력 텍스트
 * @param {string} params.output - Gemini 응답 텍스트
 * @param {string} [params.model="gemini-2.0-flash"] - 모델명
 * @param {Object|null} params.usage - Gemini usageMetadata
 * @param {number} params.usage.promptTokenCount
 * @param {number} params.usage.candidatesTokenCount
 * @param {number} params.usage.totalTokenCount
 * @param {string} params.startTime - Gemini 호출 시작 시각 (ISO 8601)
 * @param {string} params.endTime - Gemini 호출 종료 시각 (ISO 8601)
 * @param {string} [params.promptName] - Langfuse 프롬프트 이름
 * @param {number} [params.promptVersion] - Langfuse 프롬프트 버전
 * @returns {{ batch: Array }} Langfuse ingestion payload
 */
export function buildIngestionPayload({ traceId, generationId, chatId, input, output, model, usage, startTime, endTime, promptName, promptVersion }) {
  return {
    batch: [
      {
        id: crypto.randomUUID(),
        timestamp: startTime,
        type: "trace-create",
        body: {
          id: traceId,
          timestamp: startTime,
          name: "chat",
          userId: chatId,
          input,
          output,
        },
      },
      {
        id: crypto.randomUUID(),
        timestamp: startTime,
        type: "generation-create",
        body: {
          id: generationId,
          traceId,
          name: "gemini",
          startTime,
          endTime,
          model: model ?? "gemini-2.0-flash",
          input,
          output,
          usageDetails: usage
            ? {
                input: usage.promptTokenCount,
                output: usage.candidatesTokenCount,
                total: usage.totalTokenCount,
              }
            : undefined,
          promptName,
          promptVersion,
        },
      },
    ],
  };
}

/**
 * Langfuse score-create payload를 조립한다.
 *
 * @param {Object} params
 * @param {string} params.traceId - 점수를 매길 Trace 식별자
 * @param {number} params.score - 점수 (1: good, 0: bad)
 * @returns {{ batch: Array }} Langfuse ingestion payload
 */
export function buildScorePayload({ traceId, score }) {
  return {
    batch: [
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "score-create",
        body: {
          id: crypto.randomUUID(),
          traceId,
          name: "user-feedback",
          value: score,
          dataType: "NUMERIC",
        },
      },
    ],
  };
}

const PROMPT_CACHE_TTL = 300; // 5분

/**
 * Langfuse에서 프롬프트를 가져온다.
 * KV에 5분간 캐싱하여 매 요청마다 API를 호출하지 않는다.
 * 실패 시 null을 반환한다 (호출부에서 fallback 사용).
 *
 * @param {Object} env - Worker 환경변수
 * @param {string} promptName - Langfuse에 등록된 프롬프트 이름
 * @returns {Promise<{ prompt: string, version: number } | null>}
 */
export async function fetchPrompt(env, promptName) {
  const cacheKey = `prompt:${promptName}`;
  const cached = await env.CHAT_HISTORY.get(cacheKey, "json");
  if (cached) return cached;

  try {
    const baseUrl = env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com";
    const credentials = btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`);

    const resp = await fetch(`${baseUrl}/api/public/v2/prompts/${encodeURIComponent(promptName)}?label=production`, {
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!resp.ok) {
      console.error(`Langfuse prompt fetch error (${resp.status}):`, await resp.text());
      return null;
    }

    const data = await resp.json();
    if (typeof data.prompt !== "string") {
      console.error("Langfuse prompt is not text type, got:", typeof data.prompt);
      return null;
    }
    const result = { prompt: data.prompt, version: data.version };
    await env.CHAT_HISTORY.put(cacheKey, JSON.stringify(result), { expirationTtl: PROMPT_CACHE_TTL });
    return result;
  } catch (e) {
    console.error("Langfuse prompt fetch failed:", e);
    return null;
  }
}

/**
 * Langfuse ingestion API에 payload를 전송한다.
 * Basic Auth (LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY) 사용.
 * 전송 실패 시 console.error만 남기고 예외를 던지지 않는다.
 *
 * @param {Object} env - Worker 환경변수 (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL)
 * @param {{ batch: Array }} payload - buildIngestionPayload의 반환값
 */
export async function sendToLangfuse(env, payload) {
  try {
    const baseUrl = env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com";
    const credentials = btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`);

    const resp = await fetch(`${baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Langfuse ingestion error (${resp.status}):`, err);
    }
  } catch (e) {
    console.error("Langfuse send failed:", e);
  }
}
