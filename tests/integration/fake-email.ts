import type { EmailAdapter, EmailMessage } from "@/server/email/types";

export class FakeEmailAdapter implements EmailAdapter {
  readonly name = "fake";
  sent: EmailMessage[] = [];
  /** Keys the "provider" has accepted — models provider-side idempotency. */
  accepted = new Set<string>();
  failures: Error[] = [];
  constructor(public readonly supportsIdempotency = true) {}
  async send(m: EmailMessage) {
    const f = this.failures.shift();
    if (f) throw f;
    if (this.supportsIdempotency && m.idempotencyKey && this.accepted.has(m.idempotencyKey)) return { providerMessageId: "dedup" };
    if (m.idempotencyKey) this.accepted.add(m.idempotencyKey);
    this.sent.push(m);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
