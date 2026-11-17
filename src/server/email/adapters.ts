import nodemailer from "nodemailer";
import { env } from "../env";
import { logger } from "../logger";
import { PermanentEmailError, type EmailAdapter, type EmailMessage } from "./types";

/** Development adapter: prints a short summary (subject + links) — no addresses, no body PII. */
export class ConsoleEmailAdapter implements EmailAdapter {
  readonly name = "console";
  readonly supportsIdempotency = true;
  readonly sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
    const links = [...m.text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]);
    process.stdout.write(`\n[email:console] subject="${m.subject}"\n${links.map((l) => `  link: ${l}`).join("\n")}\n\n`);
    return { providerMessageId: `console-${Date.now()}` };
  }
}

export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = "smtp";
  // SMTP has no idempotency: the outbox treats a crash mid-send as "uncertain" and does not resend.
  readonly supportsIdempotency = false;
  private transport = nodemailer.createTransport({
    host: env().SMTP_HOST,
    port: env().SMTP_PORT,
    secure: env().SMTP_SECURE,
    auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASSWORD } : undefined,
  });
  async send(m: EmailMessage) {
    try {
      const info = await this.transport.sendMail({
        from: env().EMAIL_FROM,
        to: m.to,
        subject: m.subject,
        text: m.text,
        html: m.html,
        headers: { ...(m.idempotencyKey ? { "X-Idempotency-Key": m.idempotencyKey } : {}), ...m.headers },
      });
      return { providerMessageId: info.messageId ?? null };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      if (code && code >= 500 && code < 600) throw new PermanentEmailError(`SMTP rejected message (${code})`);
      throw err;
    }
  }
}

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailAdapter implements EmailAdapter {
  readonly name = "resend";
  readonly supportsIdempotency = true;
  async send(m: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env().RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: env().EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
    });
    if (res.status === 422 || res.status === 400) throw new PermanentEmailError(`Resend rejected message (${res.status})`);
    if (!res.ok) throw new Error(`Resend error ${res.status}`);
    const body = (await res.json()) as { id?: string };
    return { providerMessageId: body.id ?? null };
  }
}

let adapter: EmailAdapter | undefined;

export function emailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  const p = env().EMAIL_PROVIDER;
  adapter = p === "smtp" ? new SmtpEmailAdapter() : p === "resend" ? new ResendEmailAdapter() : new ConsoleEmailAdapter();
  logger.info("email adapter ready", { provider: adapter.name });
  return adapter;
}

/** For tests. */
export function setEmailAdapter(a: EmailAdapter | undefined) {
  adapter = a;
}
