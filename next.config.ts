import type { NextConfig } from "next";

// Content-Security-Policy is set per request (with a nonce) in src/middleware.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg-boss", "nodemailer", "@react-pdf/renderer"],
  // pdfkit (used by @react-pdf) loads its built-in fonts with a dynamic require that file tracing
  // can't see; serverless hosts (Netlify) then crash with "Cannot find module …/Helvetica.cjs".
  outputFileTracingIncludes: { "/**": ["./node_modules/pdfkit/js/standard-fonts/**/*", "./node_modules/pdfkit/js/data/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
