"use client";
import { useActionState, type ReactNode } from "react";
import { EMPLOYED_STATUSES } from "@/domain/enums";
import { enumLabel } from "@/i18n";
import type { ActionResult } from "@/lib/action";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { saveSettingsAction } from "./actions";
import type { Settings, SettingKey } from "@/server/settings";

function Section<K extends SettingKey>({ k, title, help, children }: { k: K; title: string; help: string; children: ReactNode }) {
  const [s, act, pending] = useActionState(saveSettingsAction.bind(null, k), { ok: false, error: "" } as ActionResult<null>);
  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-muted">{help}</p>
      <form action={act} className="space-y-3">
        {s.ok && <Alert tone="success">{s.message}</Alert>}
        {!s.ok && s.error && <Alert tone="danger">{s.error} {s.fieldErrors && Object.entries(s.fieldErrors).map(([f, e]) => `${f}: ${e.join(" ")}`).join(" · ")}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">{children}</div>
        <Button type="submit" disabled={pending}>Save</Button>
      </form>
    </Card>
  );
}
const N = ({ id, label, value, help }: { id: string; label: string; value: number; help?: string }) => (
  <Field id={id} label={label} help={help}><Input id={id} name={id} type="number" defaultValue={value} /></Field>
);
const STATUSES = [...EMPLOYED_STATUSES, "further_study"] as const;

export function SettingsForms({ s }: { s: Settings }) {
  return (
    <div className="space-y-4">
      <Section k="surveys" title="Check-in surveys" help="Applies to surveys scheduled or sent from now on.">
        <N id="skipWindowDays" label="Skip a survey if the graduate self-updated within (days)" value={s.surveys.skipWindowDays} />
        <N id="missedGraceDays" label="Don't send milestones older than (days) when first scheduled" value={s.surveys.missedGraceDays} />
        <N id="sendHourUtc" label="Due hour (UTC)" value={s.surveys.sendHourUtc} />
        <Field id="reminderOffsetsDays" label="Reminder days after first send" help="Comma-separated, e.g. 4, 10"><Input id="reminderOffsetsDays" name="reminderOffsetsDays" defaultValue={s.surveys.reminderOffsetsDays.join(", ")} /></Field>
        <N id="quietStart" label="Quiet hours start (local hour)" value={s.surveys.quietHours.startHour} />
        <N id="quietEnd" label="Quiet hours end (local hour)" value={s.surveys.quietHours.endHour} />
      </Section>
      <Section k="matching" title="Matching" help="Weights must add up to 100. Boosts keep recent and long-searching graduates from being overlooked.">
        <N id="wSkills" label="Weight: skills" value={s.matching.weights.skills} />
        <N id="wRole" label="Weight: role preference" value={s.matching.weights.role} />
        <N id="wLocation" label="Weight: location" value={s.matching.weights.location} />
        <N id="wBoost" label="Weight: boost" value={s.matching.weights.boost} />
        <N id="recentGraduateDays" label="Recent-graduate boost lasts (days)" value={s.matching.recentGraduateDays} />
        <N id="longSearchDays" label="Long-search boost starts after (days)" value={s.matching.longSearchDays} />
        <N id="longSearchFullDays" label="Long-search boost is full at (days)" value={s.matching.longSearchFullDays} />
      </Section>
      <Section k="reporting" title="Outcomes reporting" help="Definitions are in docs/METRICS.md. The small-group minimum cannot go below 5.">
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Count as employed (default)</legend>
          <div className="mt-1 flex flex-wrap gap-4">{STATUSES.map((v) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="employedStatuses" value={v} defaultChecked={s.reporting.employedStatuses.includes(v)} />{enumLabel("status", v)}</label>)}</div></fieldset>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Counts as a first job (time to first job)</legend>
          <div className="mt-1 flex flex-wrap gap-4">{STATUSES.map((v) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="qualifyingJobStatuses" value={v} defaultChecked={s.reporting.qualifyingJobStatuses.includes(v)} />{enumLabel("status", v)}</label>)}</div></fieldset>
        <N id="windowBeforeDays" label="Milestone window: days before" value={s.reporting.windowBeforeDays} />
        <N id="graceDays" label="Milestone window: days after" value={s.reporting.graceDays} />
        <N id="minCell" label="Smallest group shown" value={s.reporting.minCell} />
        <N id="freshnessDays" label="Fresh record = updated within (days)" value={s.reporting.freshnessDays} />
      </Section>
      <Section k="security" title="Lockout after repeated failures" help="Graduates on the same campus or mobile network share one IP address, so a stricter link lockout can briefly lock all of them out. Limits must be at least 5 failures; windows 5–60 minutes (codes 15–240).">
        <N id="gradLinkLimit" label="Graduate links: failures per IP" value={s.security.gradLink.limit} />
        <N id="gradLinkWindow" label="…within (minutes)" value={s.security.gradLink.windowMinutes} />
        <N id="partnerLinkLimit" label="Partner links: failures per IP" value={s.security.partnerLink.limit} />
        <N id="partnerLinkWindow" label="…within (minutes)" value={s.security.partnerLink.windowMinutes} />
        <N id="otpLimit" label="One-time codes: wrong codes per graduate" value={s.security.otp.limit} />
        <N id="otpWindow" label="…within (minutes)" value={s.security.otp.windowMinutes} />
      </Section>
      <Section k="retention" title="Data retention" help="A daily job anonymizes graduates this many years after graduation and deletes old logs.">
        <N id="anonymizeAfterYears" label="Anonymize graduates after (years since graduation)" value={s.retention.anonymizeAfterYears} />
        <N id="auditLogDays" label="Keep audit log for (days, min 90)" value={s.retention.auditLogDays} />
        <N id="emailLogDays" label="Keep sent-email log for (days)" value={s.retention.emailLogDays} />
      </Section>
    </div>
  );
}
