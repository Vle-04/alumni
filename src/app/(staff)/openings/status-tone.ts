import type { Tone } from "@/components/ui";
export const STATUS_TONE: Record<string, Tone> = { open: "success", pending_moderation: "warning", paused: "neutral", closed: "neutral", rejected: "danger" };
