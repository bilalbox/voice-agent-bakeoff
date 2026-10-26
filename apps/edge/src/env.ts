export type Env = {
  DB: D1Database;
  ASSETS?: Fetcher;
  WORKIZ_MODE: "mock" | "live";
  CANCEL_FEE_AMOUNT: string;
  CANCEL_FEE_HOURS: string;
  RETELL_VERIFY: string;
  RETELL_API_KEY?: string;
  WORKIZ_API_TOKEN?: string;
  WORKIZ_BASE_URL?: string;
  SEED_TOKEN?: string;
  DEMO_VOICE_TOKEN?: string;
  DEMO_PASSWORD?: string;
  RETELL_AGENT_ID?: string;
  LIVEKIT_URL?: string;
  LIVEKIT_WS_URL?: string;
  LIVEKIT_API_TOKEN?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  LIVEKIT_CONTAINER_URL?: string;
  CLOUDFLARE_AGENT_URL?: string;
  CLOUDFLARE_AGENT_SERVICE?: Fetcher;
  /** Artificial delay (ms) applied to mock list pagination for Stack 1 demos */
  MOCK_PAGE_DELAY_MS?: string;
};
