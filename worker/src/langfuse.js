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

export async function sendToLangfuse(env, payload) {
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
}
