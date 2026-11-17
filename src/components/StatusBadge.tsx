import { enumLabel } from "@/i18n";
import { Badge, type Tone } from "./ui";

const TONES: Record<string, Tone> = {
  employed_full_time: "success",
  employed_part_time: "success",
  freelance_contract: "success",
  internship: "accent",
  further_study: "accent",
  searching: "warning",
  not_searching: "neutral",
  unknown: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{enumLabel("status", status)}</Badge>;
}
