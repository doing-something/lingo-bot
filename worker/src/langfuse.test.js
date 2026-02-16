import { describe, it, expect } from "vitest";
import { buildIngestionPayload } from "./langfuse.js";

describe("buildIngestionPayload", () => {
  const baseArgs = {
    traceId: "trace-1",
    generationId: "gen-1",
    chatId: "chat-123",
    input: "Hello world",
    output: "Hi there",
    model: "gemini-2.0-flash",
    usage: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    },
    startTime: "2026-02-16T09:00:00.000Z",
    endTime: "2026-02-16T09:00:01.000Z",
  };

  it("given valid args, when built, then returns batch with trace and generation", () => {
    const payload = buildIngestionPayload(baseArgs);

    expect(payload.batch).toHaveLength(2);
    expect(payload.batch[0].type).toBe("trace-create");
    expect(payload.batch[1].type).toBe("generation-create");
  });

  it("given valid args, when built, then trace has correct fields", () => {
    const { body } = buildIngestionPayload(baseArgs).batch[0];

    expect(body.id).toBe("trace-1");
    expect(body.name).toBe("chat");
    expect(body.userId).toBe("chat-123");
    expect(body.input).toBe("Hello world");
    expect(body.output).toBe("Hi there");
  });

  it("given valid args, when built, then generation references trace", () => {
    const { body } = buildIngestionPayload(baseArgs).batch[1];

    expect(body.traceId).toBe("trace-1");
    expect(body.id).toBe("gen-1");
    expect(body.model).toBe("gemini-2.0-flash");
    expect(body.startTime).toBe("2026-02-16T09:00:00.000Z");
    expect(body.endTime).toBe("2026-02-16T09:00:01.000Z");
  });

  it("given usage metadata, when built, then maps Gemini fields to Langfuse format", () => {
    const { body } = buildIngestionPayload(baseArgs).batch[1];

    expect(body.usage).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });
  });

  it("given null usage, when built, then generation has undefined usage", () => {
    const args = { ...baseArgs, usage: null };
    const { body } = buildIngestionPayload(args).batch[1];

    expect(body.usage).toBeUndefined();
  });

  it("given batch events, when built, then each event has unique id and timestamp", () => {
    const payload = buildIngestionPayload(baseArgs);

    const ids = payload.batch.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    payload.batch.forEach((e) => {
      expect(e.timestamp).toBeDefined();
    });
  });
});
