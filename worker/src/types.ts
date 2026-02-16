export interface Env {
  GEMINI_API_KEY: string;
  TELEGRAM_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_BASE_URL: string;
  CHAT_HISTORY: KVNamespace;
}

declare module "*.txt" {
  const content: string;
  export default content;
}
