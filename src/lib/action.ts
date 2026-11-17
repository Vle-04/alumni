import { ZodError } from "zod";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const initialAction = { ok: false, error: "" } as ActionResult<never>;

/** Runs a server-action body and converts known errors into a serializable result. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of err.issues) (fieldErrors[String(i.path[0] ?? "form")] ??= []).push(i.message);
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    if (err instanceof ValidationError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof AppError) return { ok: false, error: err.message };
    // Next.js redirect()/notFound() must propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    logger.error("action failed", { err });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** FormData → plain object. Repeated keys become arrays; "on"/"true" checkboxes become booleans via `booleans`. */
export function formToObject(fd: FormData, opts: { arrays?: string[]; booleans?: string[]; json?: string[] } = {}) {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const vals = fd.getAll(key).filter((v): v is string => typeof v === "string");
    if (opts.json?.includes(key)) out[key] = JSON.parse(vals[0] ?? "null");
    else if (opts.arrays?.includes(key)) out[key] = vals.filter(Boolean);
    else out[key] = vals[0];
  }
  for (const b of opts.booleans ?? []) out[b] = ["on", "true", "1"].includes(String(out[b] ?? ""));
  for (const a of opts.arrays ?? []) out[a] ??= [];
  return out;
}
