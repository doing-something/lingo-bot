import { describe, it, expect } from "vitest";
import {
  isUrl,
  truncateText,
  extractMainContent,
  splitTelegramMessage,
  isLikelyEnglishStudyText,
  pickQuestionType,
} from "./index.js";

describe("isUrl", () => {
  it("given http URL, when checked, then returns true", () => {
    expect(isUrl("http://example.com")).toBe(true);
  });

  it("given https URL with path and query, when checked, then returns true", () => {
    expect(isUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("given URL with surrounding whitespace, when checked, then trims and returns true", () => {
    expect(isUrl("  https://example.com  ")).toBe(true);
  });

  it("given plain text, when checked, then returns false", () => {
    expect(isUrl("hello world")).toBe(false);
  });

  it("given text containing URL, when checked, then returns false", () => {
    expect(isUrl("check https://example.com please")).toBe(false);
  });

  it("given empty string, when checked, then returns false", () => {
    expect(isUrl("")).toBe(false);
  });
});

describe("truncateText", () => {
  it("given text shorter than limit, when truncated, then returns unchanged", () => {
    expect(truncateText("short text", 100)).toBe("short text");
  });

  it("given text exactly at limit, when truncated, then returns unchanged", () => {
    const text = "a".repeat(100);
    expect(truncateText(text, 100)).toBe(text);
  });

  it("given text with sentences, when truncated, then cuts at last sentence boundary", () => {
    // Given
    const text = "First sentence. Second sentence. Third sentence.";

    // When
    const result = truncateText(text, 35);

    // Then — cuts after "Second sentence." (index 31)
    expect(result).toBe("First sentence. Second sentence.");
  });

  it("given text without periods, when truncated, then falls back to word boundary", () => {
    // Given
    const text = "word ".repeat(20).trim();

    // When
    const result = truncateText(text, 18);

    // Then — last space within limit is at index 14
    expect(result).toBe("word word word");
  });

  it("given continuous text without any boundary, when truncated, then hard cuts at limit", () => {
    // Given
    const text = "a".repeat(200);

    // When
    const result = truncateText(text, 100);

    // Then
    expect(result).toBe("a".repeat(100));
  });

  it("given sentence break only in first 50%, when truncated, then skips period and uses space", () => {
    // Given — "Hi." at index 2, below 50% of maxLen(30) = 15
    const text = "Hi. " + "word ".repeat(20).trim();

    // When
    const result = truncateText(text, 30);

    // Then — period ignored, cut at space boundary instead
    expect(result.endsWith(".")).toBe(false);
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe("extractMainContent", () => {
  it("given html with <article>, when extracted, then returns article content", () => {
    // Given
    const html = '<div>noise</div><article class="post">content</article><div>more</div>';

    // When
    const result = extractMainContent(html);

    // Then
    expect(result).toBe('<article class="post">content</article>');
  });

  it("given html without <article> but with <main>, when extracted, then returns main content", () => {
    // Given
    const html = "<div>noise</div><main>content</main><div>more</div>";

    // When
    const result = extractMainContent(html);

    // Then
    expect(result).toBe("<main>content</main>");
  });

  it("given html without article or main, when extracted, then returns full html", () => {
    const html = "<div>just a div</div>";
    expect(extractMainContent(html)).toBe(html);
  });

  it("given html with both article and main, when extracted, then prefers article", () => {
    // Given
    const html = "<main>main content</main><article>article content</article>";

    // When
    const result = extractMainContent(html);

    // Then
    expect(result).toBe("<article>article content</article>");
  });

  it("given multiple <article> blocks, when extracted, then captures first block only", () => {
    // Given
    const html = "<article>first</article><article>second</article>";

    // When
    const result = extractMainContent(html);

    // Then — non-greedy match
    expect(result).toBe("<article>first</article>");
  });

  it("given <article> with attributes, when extracted, then matches correctly", () => {
    const html = '<article id="main" class="post">content</article>';
    expect(extractMainContent(html)).toBe(html);
  });
});

describe("splitTelegramMessage", () => {
  it("given short message, when split, then returns single chunk", () => {
    expect(splitTelegramMessage("hello", 100)).toEqual(["hello"]);
  });

  it("given text with paragraph breaks, when split, then prefers paragraph boundary", () => {
    // Given — total 45 chars, limit 16 forces split
    const text = "paragraph one\n\nparagraph two\n\nparagraph three";

    // When
    const chunks = splitTelegramMessage(text, 16);

    // Then
    expect(chunks[0]).toBe("paragraph one");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("given text with newlines only, when split, then uses newline boundary", () => {
    // Given
    const text = "line one\nline two\nline three\nline four";

    // When
    const chunks = splitTelegramMessage(text, 20);

    // Then
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(20);
    });
  });

  it("given text with spaces only, when split, then uses space boundary", () => {
    // Given
    const text = "word ".repeat(20).trim();

    // When
    const chunks = splitTelegramMessage(text, 18);

    // Then
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(18);
    });
  });

  it("given null or undefined, when split, then returns empty string chunk", () => {
    expect(splitTelegramMessage(null, 100)).toEqual([""]);
    expect(splitTelegramMessage(undefined, 100)).toEqual([""]);
  });

  it("given text with consecutive newlines, when split, then produces no empty chunks", () => {
    // Given
    const text = "a\n\n\n\nb";

    // When
    const chunks = splitTelegramMessage(text, 3);

    // Then
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeGreaterThan(0);
    });
  });
});

describe("isLikelyEnglishStudyText", () => {
  it("given long english paragraph, when checked, then returns true", () => {
    const text = "This is a longer English paragraph for study use. It has enough words and structure to be treated as source input.";
    expect(isLikelyEnglishStudyText(text)).toBe(true);
  });

  it("given short message, when checked, then returns false", () => {
    expect(isLikelyEnglishStudyText("hello")).toBe(false);
  });

  it("given mostly korean text, when checked, then returns false", () => {
    const text = "이 문장은 한국어가 훨씬 많고 영어는 test 정도만 포함됩니다.";
    expect(isLikelyEnglishStudyText(text)).toBe(false);
  });
});

describe("pickQuestionType", () => {
  it("given index sequence, when selected, then cycles through all types", () => {
    expect(pickQuestionType(0)).toBe("단어");
    expect(pickQuestionType(1)).toBe("구문");
    expect(pickQuestionType(2)).toBe("패턴");
    expect(pickQuestionType(3)).toBe("변환");
    expect(pickQuestionType(4)).toBe("빈칸");
    expect(pickQuestionType(5)).toBe("단어");
  });
});
