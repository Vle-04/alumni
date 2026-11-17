/**
 * Structured JSON logger. Personal data must never reach application logs: keys that look
 * like personal fields are redacted, and email-looking strings are masked.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(email|phone|name|token|code|password|secret|linkedin|address|answers)/i;
/** IP addresses: only a key that is exactly "ip" or ends in "Ip" (clientIp) — not "skipped", "description". */
const IP_KEY = /^ip$|Ip$/;
const EMAIL_RE = /[^\s@"']+@[^\s@"']+\.[^\s@"']+/g;
const PHONE_RE = /\+\d[\d ()-]{6,}\d/g;
const scrubText = (s: string) => s.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return scrubText(value);
  // The first stack line repeats the message, so the stack is scrubbed too.
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message), stack: value.stack ? scrubText(value.stack.split("\n").slice(0, 5).join("\n")) : undefined };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = (SENSITIVE_KEY.test(k) || IP_KEY.test(k)) && !/Id$|^id$|Count$/.test(k) ? "[redacted]" : scrub(v, depth + 1);
    return out;
  }
  return value;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  if (ORDER[level] < (ORDER[min] ?? 20)) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: scrub(msg), ...(scrub(fields ?? {}) as object) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

export const __test = { scrub };
