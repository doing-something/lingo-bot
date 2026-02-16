import type { Env } from "./types.js";

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface IngestionParams {
  traceId: string;
  generationId: string;
  chatId: string;
  input: string;
  output: string;
  model?: string;
  usage: GeminiUsage | null;
  startTime: string;
  endTime: string;
  promptName?: string;
  promptVersion?: number | null;
}

interface ScoreParams {
  traceId: string;
  score: number;
}

export function buildIngestionPayload({ traceId, generationId, chatId, input, output, model, usage, startTime, endTime, promptName, promptVersion }: IngestionParams) {
  return {
    batch: [
      {
        id: crypto.randomUUID(),
        timestamp: startTime,
        type: "trace-create" as const,
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
        type: "generation-create" as const,
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

export function buildScorePayload({ traceId, score }: ScoreParams) {
  return {
    batch: [
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "score-create" as const,
        body: {
          id: crypto.randomUUID(),
          traceId,
          name: "user-feedback",
          value: score,
          dataType: "NUMERIC" as const,
        },
      },
    ],
  };
}

const PROMPT_CACHE_TTL = 300; // 5분

export async function fetchPrompt(env: Env, promptName: string): Promise<{ prompt: string; version: number } | null> {
  const cacheKey = `prompt:${promptName}`;
  const cached = await env.CHAT_HISTORY.get(cacheKey, "json") as { prompt: string; version: number } | null;
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

    const data: Record<string, unknown> = await resp.json();
    if (typeof data.prompt !== "string") {
      console.error("Langfuse prompt is not text type, got:", typeof data.prompt);
      return null;
    }
    const result = { prompt: data.prompt, version: data.version as number };
    await env.CHAT_HISTORY.put(cacheKey, JSON.stringify(result), { expirationTtl: PROMPT_CACHE_TTL });
    return result;
  } catch (e) {
    console.error("Langfuse prompt fetch failed:", e);
    return null;
  }
}

export async function sendToLangfuse(env: Env, payload: { batch: unknown[] }): Promise<void> {
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
