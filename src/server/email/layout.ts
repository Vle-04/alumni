/** Minimal, accessible HTML email layout. All interpolated values are escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(opts: { title: string; paragraphs: string[]; cta?: { label: string; url: string }; footer?: string }) {
  const ps = opts.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escapeHtml(p)}</p>`).join("");
  const cta = opts.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.cta.url)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(opts.cta.label)}</a></p><p style="font-size:13px;color:#555">If the button doesn't work, copy this link: ${escapeHtml(opts.cta.url)}</p>`
    : "";
  const footer = opts.footer ? `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#666">${opts.footer}</p>` : "";
  const html = `<!doctype html><html lang="en"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px">${escapeHtml(opts.title)}</h1>${ps}${cta}${footer}</body></html>`;
  const text = [opts.title, "", ...opts.paragraphs, ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : []), ...(opts.footer ? ["", opts.footer.replace(/<[^>]+>/g, "")] : [])].join("\n");
  return { html, text };
}
