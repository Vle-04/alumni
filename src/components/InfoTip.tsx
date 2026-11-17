"use client";
import * as Tooltip from "@radix-ui/react-tooltip";

/** A keyboard-focusable "?" that shows a metric definition (hover or focus). */
export function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label={`What is “${label}”?`} className="inline-flex size-5 items-center justify-center rounded-full border border-border text-xs text-muted hover:bg-surface-2">?</button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={6} className="z-50 max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-fg shadow-lg">
            {text}
            <Tooltip.Arrow className="fill-[var(--surface)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
