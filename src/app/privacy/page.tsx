import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Markdown } from "@/lib/markdown";

export const metadata: Metadata = { title: "Privacy notice" };
export const dynamic = "force-dynamic"; // needs the per-request CSP nonce

/** Renders docs/PRIVACY.md — the single source for the privacy notice. */
export default async function PrivacyPage() {
  const source = await readFile(path.join(process.cwd(), "docs", "PRIVACY.md"), "utf8");
  return <main id="main" className="mx-auto max-w-2xl px-4 py-8"><Markdown source={source} /></main>;
}
