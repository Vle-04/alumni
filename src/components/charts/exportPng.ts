/**
 * Exports a rendered chart SVG as PNG in the browser. CSS variables and classes don't survive
 * serialization, so computed fill/stroke/font are inlined on a clone first.
 */
const PROPS = ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline"];

export async function svgToPng(svg: SVGSVGElement, filename: string, title: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i] as SVGElement;
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) target.setAttribute(p, v);
    }
  });
  const { width, height } = svg.getBoundingClientRect();
  const pad = 40;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (width + pad) * scale;
  canvas.height = (height + pad + 24) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff";
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#16181d";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width + pad, height + pad + 24);
  ctx.fillStyle = ink;
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText(title, pad / 2, 22);
  ctx.drawImage(img, pad / 2, 32, width, height);
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}
