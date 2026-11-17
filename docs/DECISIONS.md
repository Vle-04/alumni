# Decision log

Where the brief was ambiguous, we chose the **most privacy-protective, simplest reasonable option**.
Each entry says what we decided, why, and what it affects. Newest entries are at the bottom of each section.

## Platform

**D1. Pinned, well-established major versions.**
Next.js 15.5, React 19.1, Prisma 6.19, Auth.js v5 (beta 32), pg-boss 10, Vitest 3, TypeScript 5.9, Zod 4, Tailwind 4.
Newer majors exist (Prisma 7/8, TypeScript 7, Vitest 5), but these versions are mature, well documented and stable together.
Every version is pinned exactly in `package.json`. Upgrading is a separate, deliberate task.

**D2. One codebase, two processes.**
`web` (Next.js) and `worker` (pg-boss consumers + cron) share the domain and server code. The job queue lives in the same Postgres, so there's no extra infrastructure (no Redis).

**D3. Local ports.**
Postgres is mapped to host port **5440** (the default 5432 is often taken). Override with `DB_HOST_PORT`.

**D4. Clean architecture is enforced by lint.**
`src/domain/**` may not import Next.js, React, Prisma or `src/server/**`. ESLint fails the build if it does.

**D5. UI components.**
Small hand-written Tailwind primitives in `src/components/ui.tsx`, with Radix used where a widget needs complex accessibility behaviour (tooltips, dialogs).
We skipped the shadcn/ui generator to avoid a code-generation step; the result is the same idea: owned, accessible components.

**D6. Internationalisation.**
A typed message catalog (`src/i18n`) with `t("key")` and `enumLabel()`. English only for now; adding a locale means adding one file.
We avoided locale-prefixed routing because graduate links must stay short and stable.

**D7. Default Academy time zone is UTC.**
Set `ACADEMY_TIMEZONE` to the Academy's real zone. Graduates can have their own zone, which is used for quiet hours.

## Authentication & access

**D8. Staff sign-in is invitation-only.**
An Admin creates the user first. Magic links (15 minutes, single use) or optional OIDC SSO.
Database sessions last 8 hours. Role and active flag are re-read on every request, so demotions and deactivations take effect immediately. Deactivating a user deletes their sessions.

**D9. The sign-in form never reveals whether an email has an account.**
Unknown or inactive emails get the same "check your email" page, but no email is sent. The form is rate-limited per IP and per (hashed) email.

**D10. Permission checks live inside every service function.**
Each function takes a `RequestContext` and calls `requirePermission()` itself, so a route, server action or job cannot forget the check.
An integration test (`tests/integration/rbac.test.ts`) enumerates **every exported service function** and asserts that Leadership/Marketing gets `ForbiddenError`, unless the function is explicitly listed as aggregate-only.
A new export fails the test until someone makes that decision.

**D11. "Leadership / Marketing" is one role (`LEADERSHIP`).**
The brief gives both groups identical rights (aggregates only), so they share a role.

## Personal data

**D12. Contact fields are encrypted at the application level.**
Email, phone and LinkedIn URL use AES-256-GCM with versioned keys (`DATA_ENCRYPTION_KEYS`, newest first, so keys can be rotated).
Email lookups and duplicate checks use an HMAC blind index (`emailHash`), never decryption.

**D13. Names are not encrypted.**
Staff need to search and sort by name, and encrypted names can't be searched. Names are protected by role checks, never appear in logs, and Marketing can't reach them.
Production should also use encrypted disks/volumes.

**D14. Contact details are hidden by default, even for Career Services.**
The graduate page shows *which* contact fields are on file. "Show contact details" decrypts them and writes a `contact.read` audit entry. Opening the edit form is also audited, because it decrypts contact data.

**D15. The audit log never stores contact values.**
Diffs record `{ "changed": true }` for email/phone/LinkedIn instead of the values. The audit log must not become a second copy of personal data.

**D16. The LinkedIn URL is plain text, never a link.**
It's stored only as text the graduate (or staff) typed, and shown as plain text rather than a clickable link, so the app itself never navigates to a profile.
`npm run check:no-scraping` (in CI) fails on scraping libraries, non-allowlisted outbound HTTP calls, or any `linkedin.com` reference in application code.

**D17. The application logger redacts personal data.**
Keys that look personal (email, name, phone, token, IP, answers…) are redacted, and email-like strings are masked. Prisma query parameters are never logged.

**D18. No protected attributes exist in the schema.**
That means no age, gender, nationality, photo or date of birth. CSV columns with such data are reported as "ignored" and never stored.

## Records

**D19. Employment history is append-only.**
Corrections are new rows with `supersedesId`. `Graduate.currentStatus`, `currentStatusAt`, `currentInField` and `searchingSince` are a cache recomputed from history: the latest record by `reportedAt`.
`searchingSince` is the start of the current uninterrupted run of "searching" records.

**D20. "Last updated" means the date of the latest employment record.**
That record can come from a survey, a self-update, staff entry, an import or a referral hire. A record is **stale** after 90 days with no update; graduates who never reported anything count as stale.

**D21. Graduation date comes from the cohort, with an optional per-graduate override.**
Surveys use whichever date applies.

## Companies

**D22. Same company vs. merge suggestions.**
Names that differ only by case, punctuation, accents or legal form ("Google" / "Google LLC" / "google, inc.") normalise to the same key and are treated as the **same** company. That is a lookup, not a merge.
Anything only *similar* creates a merge suggestion that staff must accept: a bigram similarity of at least 0.82, or one name being a word-prefix of the other ("Picsart" / "Picsart Armenia").
Accepting moves records, openings, contacts and aliases into the target, then deletes the source. The merge is audited.

## CSV import

**D23. Uploaded files are never stored.**
The preview stores only counts and a SHA-256 hash. On commit the browser re-sends the file and the hash must match. The preview returned to the browser has no contact data (row number, name and errors only).

**D24. Duplicates are skipped, not merged.**
That covers duplicates by email within the file and against existing graduates. Updating existing graduates from CSV isn't supported; staff edit them individually. This avoids silent overwrites.

**D25. Consent is granted only by an explicit "yes" in a consent column.**
The source is recorded as `csv_import` with the current policy version. A blank means not granted.

**D26. Unknown skill names become new canonical skills.**
Admins can later turn them into synonyms of an existing skill.

## Testing

**D27. The app has no test-only routes.**
End-to-end tests sign in by creating a database session row directly. That is equivalent to clicking a magic link, and it means production code contains no back door.

**D28. Test databases must be named `*_test`.**
Destructive setup (truncate + reseed) refuses to run against any other name (`tests/test-db-guard.ts`).
Prisma blocks AI agents from running `prisma migrate reset`, so test setup uses `migrate deploy` plus a guarded `TRUNCATE`. `npm run db:reset` is for humans resetting their own dev database.

## Planned decisions for later phases (recorded now, implemented in their phase)

- **Surveys (Phase 2).**
  - Each graduate gets exactly one survey per milestone, enforced by a unique `(graduateId, milestone)` constraint.
  - When the date changes, unsent surveys are rescheduled; sent ones are kept.
  - Milestones already in the past when a survey is first scheduled are marked `missed` and never sent.
  - The "self-updated in the last 14 days" skip rule is checked when the survey is due to go out.
- **No duplicate emails (Phase 2).** Every email goes through an outbox with a unique idempotency key. With SMTP, an email whose send was interrupted by a crash is marked `uncertain` and goes to the dead-letter view rather than being resent: at most one email, never two.
- **Personal links (Phase 2).** Opening a link exchanges the token for a short-lived HTTP-only cookie, then redirects to a clean URL, so the token stays out of browser history and isn't sent to other sites.
- **Status at 6 or 12 months (Phase 4).** We use the latest record reported between the milestone date minus 90 days and the milestone date plus 45 days; otherwise the status is unknown and counted as unknown.
- **Time to first job (Phase 4).** A survival-analysis method (Kaplan–Meier) that counts graduates who haven't found work yet instead of dropping them.
- **Small groups (Phase 4).** Any count below 5 is shown as "<5", and a second cell is hidden when needed so the hidden value can't be worked out by subtraction.
- **Consent and reports (Phase 4/5).** Graduates who revoke `outcomes_reporting` are left out of aggregates from then on. Deleting a graduate anonymises them and keeps their reporting status, so aggregates don't change.
