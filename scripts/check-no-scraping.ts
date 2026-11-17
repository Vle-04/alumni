/**
 * Hard constraint: the system must never scrape LinkedIn or any third-party profile.
 * This check fails CI if:
 *  1. a scraping / headless-browser / HTML-parsing library is a runtime dependency;
 *  2. application code makes an outbound HTTP call to a non-allowlisted host;
 *  3. application code references linkedin.com (a LinkedIn URL may only be stored as text the graduate types).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_DEPS = [
  "puppeteer", "puppeteer-core", "playwright", "playwright-core", "cheerio", "jsdom", "node-html-parser", "x-ray", "osmosis",
  "crawlee", "got-scraping", "selenium-webdriver", "linkedin-api", "linkedin-private-api", "proxycurl", "nightmare", "htmlparser2",
];
/** The only external hosts application code may call. */
const ALLOWED_HOSTS = ["api.resend.com"];
const APP_DIRS = ["src", "prisma"];
const HTTP_CLIENT_IMPORT = /from\s+["'](axios|got|node-fetch|undici|superagent|request|needle|ky|http|https|node:http|node:https)["']/;

const problems: string[] = [];

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (FORBIDDEN_DEPS.includes(dep) || /scrap|crawl|linkedin/i.test(dep)) problems.push(`package.json: forbidden runtime dependency "${dep}"`);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

for (const dir of APP_DIRS) {
  for (const file of walk(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/(^|[^:])\/\/.*$/, "$1");
      const where = `${file}:${i + 1}`;
      if (HTTP_CLIENT_IMPORT.test(code)) problems.push(`${where}: imports an HTTP client — outbound calls must go through an allowlisted adapter`);
      const fetchCall = /\bfetch\(\s*([^,)]*)/.exec(code);
      if (fetchCall) {
        const target = fetchCall[1]!.trim();
        const literal = /^["'`](https?:\/\/[^/"'`]+)/.exec(target);
        const relative = /^["'`]\//.test(target);
        if (!relative && !(literal && ALLOWED_HOSTS.includes(new URL(literal[1]!).host))) problems.push(`${where}: fetch() to a non-allowlisted or dynamic URL (${target.slice(0, 60)})`);
      }
      if (/linkedin\.com/i.test(code) && !file.startsWith("prisma/seed")) problems.push(`${where}: references linkedin.com`);
    });
  }
}

if (problems.length) {
  console.error("No-scraping check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("No-scraping check passed: no scraping libraries, no non-allowlisted outbound calls, no LinkedIn access.");
