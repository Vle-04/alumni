import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Raw console output can leak personal data; use src/server/logger.ts instead.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    // Clean architecture: domain logic must not depend on the framework, database or server adapters.
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/server/*", "@/app/*", "@/components/*", "@prisma/client", "next", "next/*", "react"], message: "Domain modules must stay framework-independent." }],
      }],
    },
  },
  { files: ["prisma/**", "scripts/**", "tests/**"], rules: { "no-console": "off" } },
];
export default config;
