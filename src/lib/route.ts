/**
 * Every route handler is built with `validatedRoute`: path params, query string and body are each
 * parsed with a Zod schema BEFORE the handler runs, and the handler only sees parsed values.
 * tests/static/validation.test.ts requires this for every route (except Auth.js's own).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";

type In<S> = S extends ZodType ? z.output<S> : undefined;

export interface RouteSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export interface RouteInput<S extends RouteSchemas> {
  params: In<S["params"]>;
  query: In<S["query"]>;
  body: In<S["body"]>;
}

/** URLSearchParams → object; repeated keys become arrays. */
export function queryToObject(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

async function readBody(req: NextRequest): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (!text) return {};
  if (type.includes("application/json")) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}

export function validatedRoute<S extends RouteSchemas>(
  schemas: S,
  handler: (req: NextRequest, input: RouteInput<S>) => Promise<Response>,
  onInvalid: (req: NextRequest, error: z.ZodError | Error) => Response | Promise<Response> = () =>
    NextResponse.json({ error: "validation" }, { status: 422 }),
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string | string[] | undefined>> }): Promise<Response> => {
    try {
      const params = schemas.params ? schemas.params.parse(await ctx.params) : undefined;
      const query = schemas.query ? schemas.query.parse(queryToObject(req.nextUrl.searchParams)) : undefined;
      const body = schemas.body ? schemas.body.parse(await readBody(req)) : undefined;
      return await handler(req, { params, query, body } as RouteInput<S>);
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError) return onInvalid(req, e);
      throw e;
    }
  };
}

export const tokenParam = z.object({ token: z.string().min(1).max(1024) }).strict();
export const idParam = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) }).strict();
