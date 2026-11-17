export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Passed to providers that support idempotent sends, so a retried send is not delivered twice. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  providerMessageId: string | null;
}

export interface EmailAdapter {
  readonly name: string;
  /** True if the provider de-duplicates on idempotencyKey (safe to retry after a crash). */
  readonly supportsIdempotency: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}

/** Thrown for permanent failures (invalid address, hard bounce) — do not retry. */
export class PermanentEmailError extends Error {
  override name = "PermanentEmailError";
}
