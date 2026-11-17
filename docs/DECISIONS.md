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

## Surveys & email (Phase 2)

**D29. One survey per milestone, rescheduled rather than duplicated.**
Each graduate has exactly one survey row per milestone (1/3/6/12 months), enforced by the unique `(graduateId, milestone)` constraint and by an idempotent planner (`src/domain/scheduling/surveys.ts`).
- The due time is graduation + N calendar months at 09:00 UTC; quiet hours are applied at send time.
- Changing the graduation date (cohort-wide, a per-graduate override, or moving a graduate to another cohort) moves only unsent surveys (`scheduled`/`missed`/`cancelled`). Sent and answered surveys are history.
- Removing the date cancels unsent surveys; setting it again brings them back.

**D30. Old milestones are "missed", never sent.**
A milestone more than 14 days (configurable) in the past at scheduling time is marked `missed`. Graduates imported from old cohorts don't receive a "1-month" survey years later.

**D31. The skip rule is checked when the survey is due.**
If the graduate self-updated within the skip window (14 days, configurable), the survey becomes `skipped_recent_update` and counts as a response.

**D32. Survey statuses track real delivery.**
`scheduled` → `queued` (email enqueued) → `sent` (only once the provider accepted it) → `completed`. A hard bounce sets `bounced`. Unsubscribed or deleted graduates get `cancelled`.

**D33. Reminders: two at most, then stop.**
They go out 4 and 10 days after the first send (configurable). They stop once the survey is completed or the graduate unsubscribes. Each reminder has its own idempotency key (`survey:<id>:reminder:<n>`).

**D34. Email outbox (`src/server/outbox.ts`).**
Every email (surveys, reminders, links, codes) is a row with a unique idempotency key. Workers claim rows with `FOR UPDATE SKIP LOCKED`.
- **Crash during a send:** if the provider de-duplicates (Resend, console), the row is retried with the same key. Plain SMTP can't de-duplicate, so the row becomes `uncertain`. It appears in the dead-letter view and is never resent automatically, so a graduate gets at most one email, never two.
- **Transient errors** retry with exponential backoff, up to 5 attempts. **Permanent errors** go straight to `dead`.
- **Stored errors** are scrubbed of email addresses.

**D35. Quiet hours: 21:00–08:00 in the graduate's time zone.**
The Academy's zone is used if the graduate has none. Quiet hours apply only to survey, reminder and match emails. Links and codes the graduate asked for go out immediately.

**D36. Unsubscribing never happens on a GET request.**
The unsubscribe link shows a confirmation page, because corporate email link scanners follow links. Mail clients get RFC 8058 one-click `List-Unsubscribe-Post`.
Unsubscribe tokens last 1 year and aren't tied to the token version, so rotating a graduate's links doesn't break "stop emails".

## Personal links (Phase 2)

**D37. Links are signed, expire, and can be revoked.**
- **Format:** HMAC-SHA256 signed; payload holds the graduate id, token version, purpose, expiry (30 days) and an optional reference (survey or match id).
- **Opening a link:** `/u/<token>` checks it, sets a 2-hour HTTP-only `SameSite=Lax` session cookie and redirects with 303 to a clean URL.
- **Revocation:** the token version is re-checked against the database on every request. Rotating it revokes all old links **and** any open session.
- **Email scanners:** opening a link has no side effects, so scanners that follow links can't change anything.

**D38. Staff can email a graduate a fresh link but never see it.**
This prevents staff from signing in as a graduate.

**D39. Requesting a new link never reveals whether an email exists.**
The response is always the same. Requests are rate-limited per IP (10 per 15 minutes) and per email (3 per hour, dropped silently). Opening a link is rate-limited per IP (60 per 15 minutes).

**D40. One-time codes for sensitive actions.**
- **Format:** 6 digits, valid 10 minutes, 5 attempts, single use; requesting a new code voids older ones. At most 3 requests per 15 minutes.
- **Delivery:** codes always go to the email **on file**.
- **Storage:** the code is stored as a keyed hash. In the outbox it's encrypted and wiped from the email row once sent.

## Survey form (Phase 2)

**D41. Survey length.**
"Nothing changed" is 1 tap. The employed branch has 7 questions (status, company, role, start month, in-field, salary band (optional), open to other offers). The searching branch has 3 (status, blockers, help wanted).
"Open to offers" sits on the employed branch because people who are searching are always matched.

**D42. Branching works without JavaScript state.**
It uses CSS `:has()`. Browsers without `:has()` show every question, and the server ignores answers that don't apply.
"Yes, nothing changed" is a separate `<form>`, so pressing Enter in a text field can never submit it by accident.

**D43. Response rate definition.**
(completed + skipped because of a recent self-update) ÷ surveys that went out (sent + completed + bounced + skipped). Surveys that are scheduled, queued, missed or cancelled are not in the denominator.

## Placement & referrals (Phase 3)

**D44. Matching is a pure function with explanations.**
`src/domain/matching/match.ts` is deterministic. Ties are broken by score, then longest searching first, then id. Each match lists, in plain language, every factor that affected its score.
- **Filters:** status is `searching` (or the graduate chose "open to offers"); `job_matching` consent; location fits; every must-have skill present.
- **Score:** 60 skills + 15 role + 15 location + 10 boost. Admins can change the weights in Settings; they must add up to 100.
- **What graduates see:** match emails explain only skills and location, never the internal boost.

**D45. Edge cases in the score.**
- An opening with no skills listed gives full skill credit and says so.
- A graduate with no role preference gets half role credit (0.5), so having no preference is neither rewarded nor punished.
- A remote role counts as compatible for everyone; on-site-only people get a slightly lower location fit (0.7).
- On-site and hybrid roles need the same city, or the graduate must be open to relocating (fit 0.5).
- Graduates whose status is "unknown" are **not** matched until they tell us they're searching. That's privacy-protective: the brief requires a status of searching or an opt-in.

**D46. Matching reads only a fixed list of fields.**
The list is `MATCH_CANDIDATE_FIELDS`, and a unit test fails if it ever includes anything that looks like a protected attribute. The database adapter builds candidates only from those fields.

**D47. Only the graduate can mark interest; sharing is gated in code.**
- Only the graduate can move a referral to `graduate_interested`, by clicking Interested.
- "Not interested" withdraws the referral. The graduate can still change their mind until they've been referred.
- Moving to `referred` or any later stage requires **both** the Interested click **and** active `share_with_partners` consent (`checkTransition`).
- The partner portal re-checks both on **every read** (`partnerCandidate`). Revoking consent hides details immediately, and each disclosure is audited as `contact.read` by the partner.

**D48. What partners see.**
Partners only see referrals that actually reached `referred`; earlier stages stay internal. When the gate allows it, they see name, email, LinkedIn URL (as text), skills and preferred roles. They never see phone, salary or status history.

**D49. Pipeline rules.**
- `hired` only follows `offer`, and is final.
- Staff can skip forward once interest exists, step back one stage to fix mistakes, and reopen a rejected or withdrawn referral up to its previous stage.
- Every move is a time-stamped `ReferralTransition` plus an audit entry.

**D50. Hire records.**
Moving to `hired` immediately creates an `EmploymentRecord`: source `referral_hire`, prefilled with the opening's company and title, not yet verified. That way the outcomes report updates even if staff skip the prompt.
The prompt lets staff confirm (marks the record verified) or correct it (appends a verified record that supersedes the first).

**D51. Referral metrics come from transition history.**
- **Conversion per stage:** referrals that reached stage N+1 ÷ referrals that reached stage N.
- **Days to hire:** measured from `referred` to `hired`.
- **Hires per company:** partners are flagged separately.

**D52. Drag and drop has an accessible alternative.**
dnd-kit supports pointer, touch and keyboard, with spoken announcements. Every card also has a "Move to…" menu listing only the moves the server allows.

**D53. Partner portal links.**
Signed, 90 days, versioned per contact; revoke and reissue from the company page. The link starts an 8-hour session.
Staff copy the link and send it themselves: the outbox only emails graduates, and partner links are not personal data about graduates.

**D54. Synonym merges.**
Admins can merge one skill into another. Graduates keep the higher self-rated level, openings keep the higher weight and the must-have flag, and the old name becomes a synonym.

**D55. Match emails respect check-in unsubscribes and quiet hours.**
Graduates can still see their matches on `/me`.

## Planned decisions for later phases (recorded now, implemented in their phase)

- **Status at 6 or 12 months (Phase 4).** We use the latest record reported between the milestone date minus 90 days and the milestone date plus 45 days; otherwise the status is unknown and counted as unknown.
- **Time to first job (Phase 4).** A survival-analysis method (Kaplan–Meier) that counts graduates who haven't found work yet instead of dropping them.
- **Small groups (Phase 4).** Any count below 5 is shown as "<5", and a second cell is hidden when needed so the hidden value can't be worked out by subtraction.
- **Consent and reports (Phase 4/5).** Graduates who revoke `outcomes_reporting` are left out of aggregates from then on. Deleting a graduate anonymises them and keeps their reporting status, so aggregates don't change.
