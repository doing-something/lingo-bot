import SYSTEM_PROMPT from "../prompts/system-prompt.txt";

export { SYSTEM_PROMPT };

export const MAX_TURNS = 20;
export const HISTORY_TTL = 60 * 60 * 24 * 7; // 7일
export const TELEGRAM_MAX_LEN = 4096;
export const TELEGRAM_SAFE_LEN = 3900;
export const MAX_HTML_SIZE = 512 * 1024; // 512KB
export const MAX_TEXT_LEN = 10000;

export function feedbackKeyboard(traceId) {
  return {
    inline_keyboard: [[
      { text: "\uD83D\uDC4D \uB3C4\uC6C0\uB410\uC5B4\uC694", callback_data: `good:${traceId}` },
      { text: "\uD83D\uDC4E \uC544\uC26C\uC6CC\uC694", callback_data: `bad:${traceId}` },
    ]],
  };
}
