/**
 * Server actions are public HTTP endpoints: anyone can call them with any arguments.
 * Every action validates its declared parameters with a Zod tuple as its first statement
 * (`parseArgs(schema, [a, b, c])`); form fields are then validated again by the service schema.
 * (Next.js forbids `arguments` in server actions; undeclared extra arguments are never read.)
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
