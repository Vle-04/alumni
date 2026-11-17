/**
 * "Survey and self-update pages load fast on a slow phone connection."
 * Emulates a slow 4G phone (1.6 Mbps down, 150 ms RTT, 4× CPU slowdown) in Chromium.
 */
import { expect, test } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "CDP throttling is Chromium-only");

const PAGES = [
  { name: "survey page", purpose: "survey" as const },
  { name: "self-update page (/me)", purpose: "profile" as const },
];

for (const target of PAGES) test(`${target.name} is usable within 4 s on a slow phone, under 200 KB compressed`, async ({ page, context }) => {
  const s = await db.surveyInstance.findFirstOrThrow({ where: { status: "sent", graduate: { anonymizedAt: null, currentStatus: { not: "unknown" } } }, include: { graduate: true } });
  const token = signToken({ sub: s.graduateId, v: s.graduate.profileTokenVersion, p: target.purpose, ...(target.purpose === "survey" ? { ref: s.id } : {}), exp: Math.floor(Date.now() / 1000) + 600 }, process.env.TOKEN_SIGNING_KEY!);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let bytes = 0;
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; });

  const started = Date.now();
  await page.goto(`/u/${token}`);
  const button = page.getByRole("button", { name: "Yes, nothing changed" }).first();
  await expect(button).toBeEnabled();
  await page.waitForLoadState("load");
  const ms = Date.now() - started;
  test.info().annotations.push({ type: "perf", description: `usable after ${ms} ms, ${Math.round(bytes / 1024)} KB transferred` });
  console.log(`${target.name} on slow 4G + 4× CPU: usable after ${ms} ms, ${Math.round(bytes / 1024)} KB transferred`);
  expect(ms).toBeLessThan(4000);
  expect(bytes).toBeLessThan(200 * 1024);
});
