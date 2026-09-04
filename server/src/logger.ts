export interface OperationalLogEvent {
  serverRequestId: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  payloadBytes: number | null;
  evidenceCount: number | null;
  providerLatencyMs: number | null;
  errorCategory: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface OperationalLogger {
  write(event: OperationalLogEvent): void;
}

export const jsonOperationalLogger: OperationalLogger = {
  write(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  },
};
