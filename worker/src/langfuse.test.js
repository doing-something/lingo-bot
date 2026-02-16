import { describe, it, expect } from "vitest";
import { buildIngestionPayload, buildScorePayload } from "./langfuse.js";

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

    expect(body.usageDetails).toEqual({
      input: 10,
      output: 20,
      total: 30,
    });
  });

  it("given null usage, when built, then generation has undefined usageDetails", () => {
    const args = { ...baseArgs, usage: null };
    const { body } = buildIngestionPayload(args).batch[1];

    expect(body.usageDetails).toBeUndefined();
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

describe("buildScorePayload", () => {
  it("given good feedback, when built, then returns score-create with value 1", () => {
    const payload = buildScorePayload({ traceId: "trace-1", score: 1 });

    expect(payload.batch).toHaveLength(1);
    expect(payload.batch[0].type).toBe("score-create");
    expect(payload.batch[0].body.value).toBe(1);
  });

  it("given bad feedback, when built, then returns score-create with value 0", () => {
    const payload = buildScorePayload({ traceId: "trace-1", score: 0 });

    expect(payload.batch[0].body.value).toBe(0);
  });

  it("given traceId, when built, then body references the trace", () => {
    const payload = buildScorePayload({ traceId: "trace-abc", score: 1 });

    expect(payload.batch[0].body.traceId).toBe("trace-abc");
    expect(payload.batch[0].body.name).toBe("user-feedback");
    expect(payload.batch[0].body.dataType).toBe("NUMERIC");
  });

  it("given payload, when built, then event and body have unique ids", () => {
    const payload = buildScorePayload({ traceId: "trace-1", score: 1 });

    const eventId = payload.batch[0].id;
    const bodyId = payload.batch[0].body.id;
    expect(eventId).toBeDefined();
    expect(bodyId).toBeDefined();
    expect(eventId).not.toBe(bodyId);
  });

  it("given payload, when built, then event has ISO timestamp", () => {
    const payload = buildScorePayload({ traceId: "trace-1", score: 1 });

    expect(payload.batch[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
