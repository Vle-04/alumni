import { execSync } from "node:child_process";
import "./load-env";

export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
}
