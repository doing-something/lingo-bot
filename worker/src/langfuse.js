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
 * @returns {{ batch: Array }} Langfuse ingestion payload
 */
export function buildIngestionPayload({ traceId, generationId, chatId, input, output, model, usage, startTime, endTime }) {
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
          usage: usage
            ? {
                input_tokens: usage.promptTokenCount,
                output_tokens: usage.candidatesTokenCount,
                total_tokens: usage.totalTokenCount,
              }
            : undefined,
        },
      },
    ],
  };
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
