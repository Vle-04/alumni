/**
 * Server actions are public HTTP endpoints: anyone can call them with any arguments.
 * Every action takes ALL its arguments as a typed rest tuple and validates them with a Zod tuple
 * as its first statement:  `async function x(...args: [id: string]) { const [id] = parseArgs(S, args) }`
 * so extra or missing arguments are rejected too. (Next.js forbids the `arguments` object in
 * server actions — the build fails with "Server Actions cannot use `arguments`" — but typed rest
 * parameters are allowed and keep call-site types.)
 * A static test (tests/static/validation.test.ts) enforces this for every action and route.
 */
import { z } from "zod";

export const A = {
  /** Database ids (cuid). */
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id"),
  form: z.instanceof(FormData),
  /** Previous state passed by useActionState — never trusted or used. */
  prev: z.unknown(),
};

export function parseArgs<T extends z.ZodTuple>(schema: T, args: readonly unknown[]): z.output<T> {
  // Trailing `undefined`s (optional params not passed) are trimmed so optional tuple slots work.
  const a = [...args];
  while (a.length && a[a.length - 1] === undefined) a.pop();
  return schema.parse(a) as z.output<T>;
}
