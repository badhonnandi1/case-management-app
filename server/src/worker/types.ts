export interface D1Result<Row = Record<string, unknown>> {
  success: boolean;
  results?: Row[];
  meta?: {
    changes?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
  run<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface WorkerEnv {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  SESSION_SIGNING_SECRET?: string;
  AI_ONLINE_ENABLED?: string;
  AI_PUBLIC_MODEL_ID?: string;
  AI_PUBLIC_MODEL_NAME?: string;
  GEMINI_DEFAULT_MODEL?: string;
  GROQ_FALLBACK_MODEL?: string;
  AI_FALLBACK_ENABLED?: string;
  AI_PRIVACY_POLICY_ID?: string;
  AI_CONSENT_POLICY_VERSION?: string;
  ANSWER_RATE_LIMIT_PER_MINUTE?: string;
  AI_DAILY_PER_TESTER_LIMIT?: string;
  AI_DAILY_GLOBAL_LIMIT?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  SESSION_TTL_SECONDS?: string;
  PROVIDER_TIMEOUT_MS?: string;
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD?: string;
  PROVIDER_CIRCUIT_OPEN_SECONDS?: string;
}

export interface WorkerOperationalLogEvent {
  serverRequestId: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  payloadBytes: number | null;
  evidenceCount: number | null;
  provider: 'gemini' | 'groq' | null;
  fallbackUsed: boolean;
  errorCategory: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface WorkerOperationalLogger {
  write(event: WorkerOperationalLogEvent): void;
}

export const workerJsonLogger: WorkerOperationalLogger = {
  write(event) {
    console.log(JSON.stringify(event));
  },
};
