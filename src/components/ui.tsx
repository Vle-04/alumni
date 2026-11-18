import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const btnBase = "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-10";
const variants = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-danger text-danger-fg hover:opacity-90",
} as const;
type Variant = keyof typeof variants;

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(btnBase, variants[variant], className)} {...p} />;
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(btnBase, variants[variant], className)} {...p} />;
}

const inputCls = "block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted aria-[invalid=true]:border-danger min-h-10";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(inputCls, className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cn(inputCls, "pr-8", className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputCls, className)} {...p} />;
}

/** Label + control + help + error, wired with aria-describedby. */
export function Field({ id, label, help, error, children, className }: { id: string; label: ReactNode; help?: ReactNode; error?: string[] | string; children: ReactNode; className?: string }) {
  const errs = typeof error === "string" ? [error] : error;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
      {help && <p id={`${id}-help`} className="text-xs text-muted">{help}</p>}
      {errs?.length ? <p id={`${id}-error`} className="text-xs text-danger" role="alert">{errs.join(" ")}</p> : null}
    </div>
  );
}

export function describedBy(id: string, opts: { help?: boolean; error?: unknown }) {
  return [opts.help && `${id}-help`, opts.error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // min-w-0: inside a grid/flex parent, a wide table must scroll inside the card, not stretch the page.
    <section className={cn("min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-surface-2 text-fg border-border",
  success: "border-success/40 text-success bg-success/10",
  warning: "border-warning/40 text-warning bg-warning/10",
  danger: "border-danger/40 text-danger bg-danger/10",
  accent: "border-accent/40 text-accent bg-accent/10",
} as const;
export type Tone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone], className)}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">{children}</p>;
}

export function Table({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    // Focusable region: a table wider than the screen must be scrollable with the keyboard too (WCAG 2.1.1).
    // `relative` keeps visually-hidden (absolute) text like the caption inside the scroller, not stretching the page.
    <div role="region" aria-label={caption} tabIndex={0} className={cn("relative overflow-x-auto rounded-lg border border-border bg-surface", className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ className, ...p }: ComponentProps<"th">) => <th scope="col" className={cn("border-b border-border bg-surface-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted", className)} {...p} />;
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cn("border-b border-border px-3 py-2 align-top", className)} {...p} />;

/** Alerts use body ink for text (always ≥ 4.5:1); the tone is carried by the border and tint. */
const alertTones = {
  neutral: "border-border bg-surface-2",
  success: "border-success/50 bg-success/10",
  warning: "border-warning/60 bg-warning/10",
  danger: "border-danger/60 bg-danger/10",
  accent: "border-accent/50 bg-accent/10",
} as const;
export function Alert({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border border-l-4 px-3 py-2 text-sm text-fg", alertTones[tone])}>{children}</div>;
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (p: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link className="underline" href={hrefFor(page - 1)}>← Previous</Link> : <span />}
      <span className="text-muted">Page {page} of {pageCount}</span>
      {page < pageCount ? <Link className="underline" href={hrefFor(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
