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
A milestone more than 14 days (configurable) in the past at scheduling time is marked `missed`. Graduates imported from old cohorts don't receive a "1-month" survey years later. *Amended by D82:* the most recent missed milestone becomes one catch-up survey.

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
- Graduates whose status is "unknown" are **not** matched until they tell us they're searching. That's privacy-protective: the brief requires a status of searching or an opt-in. *Amended by D84:* new graduates are presumed searching at graduation.

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
- `hired` only follows `offer`. *Amended by D81:* a hire can be undone back to `offer`.
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

## Reporting (Phase 4)

All metric definitions are in [METRICS.md](METRICS.md). The decisions behind them:

**D56. Status at a milestone uses a window.**
The status is the latest record reported in [milestone − 90 days, milestone + 45 days], skipping jobs that started after the milestone; nothing in the window means unknown.
Graduates are measured only once milestone + 45 days has passed, so recent cohorts read as "not yet measurable" rather than as unknowns.

**D57. The employment rate's denominator is "known status".**
The response rate, the unknown count and a **lower bound** (unknown counted as not employed) are always shown next to it.
Which statuses count as employed is configurable per report ("Count as employed"). In-field-only is a toggle; jobs with no in-field answer are counted separately.

**D58. Time to first job uses Kaplan–Meier.**
Graduates without a job are counted until their last known update. Median and quartiles show "not reached" instead of being invented.
Internships don't count as a first job by default (configurable). A job that started before graduation counts as day 0 and is reported separately.

**D59. Privacy rules: k = 5, with secondary suppression and rate bounds.**
- Counts of 1–4 are shown as "<5".
- If one cell in a group with a published total is hidden, a second cell is hidden too.
- Rates that would reveal a small group show a **bound** ("<10%", ">76%"), which reveals no more than the "<5" cell would. That keeps "always show the response rate" without leaking small counts.
- `minCell` cannot be set below 5.

**D60. Cohorts with fewer than 5 reportable graduates are excluded from every figure, totals included.**
Filters select whole cohorts, by program, cohort or graduation date range. This prevents differencing attacks (comparing two date ranges to isolate a small cohort), and a test shows that including or excluding a tiny cohort yields identical results.

**D61. Employers are named only with 5 or more graduates.**
Every other company is grouped as "Other employers", so a company name can never point to one person.

**D62. Time-to-job privacy.**
Medians are hidden below 5 job starts. A point on a cohort curve is hidden once fewer than 5 of its graduates are still being followed.

**D63. Exports.**
- **CSV:** aggregates only. Cells starting with `= + - @` are neutralised to prevent formula injection.
- **PDF:** generated on the server with `@react-pdf/renderer` (no headless browser).
- **PNG:** rendered in the browser from the chart SVG, with computed colours inlined; the server logs the download before it happens.
- **Audit:** every export is written to the audit log with the format and filters used.

**D64. Charts.**
Recharts with the validated categorical palette (`#2a78d6, #eb6834, #1baf7a, #eda100, #e87ba4, #008300` light; dedicated dark steps). Slots are assigned in fixed order and validated against the app's own surfaces.
- **Colour follows the cohort:** slots are assigned over all cohorts by graduation order, so filtering never repaints a line.
- **Contrast:** three light-mode colours are below 3:1 contrast against the surface, so every chart has a "Show data table" twin, plus value labels on bars.
- **One y-axis per chart.** Legend text uses text colour, in series order.
- **Every metric has a definition tooltip** that works with keyboard focus and hover.

**D65. "Needs attention" queue (the dashboard).**
- **Long search:** searching more than 60 days with **no referral created since the current search began**.
- **Stuck referral:** an open referral with no stage change for more than 14 days.
- **New openings:** openings from the last 30 days with zero eligible matches.
- **Also listed:** bounced surveys, stale records, and failed or uncertain emails.

## Hardening (Phase 5)

**D66. Deletion is anonymization.**
- **Removed:** name (replaced by `Deleted graduate #<hash>`), email, its blind index, phone, LinkedIn URL, location, time zone, preferences, skills, survey answers, referral notes, one-time codes and pending emails.
- **Kept:** cohort, graduation-date override, consent states, employment history, survey statuses and referral stages.
- **Result:** reports are byte-for-byte identical after a deletion (tested); all links and sessions stop working; the email can be registered again.
- **Who can trigger it:** the graduate (one-time code), an Admin (typing DELETE), or the retention job.

**D67. Data export.**
A graduate downloads all their data as JSON after entering a one-time code. Admins can export on a graduate's behalf (`data:export_all`). Both are audited.

**D68. Retention.**
A daily job anonymizes graduates N years after graduation (default 5). It deletes audit logs older than 3 years (minimum 90 days) and email logs older than 90 days. Admins configure these under Settings.

**D69. Settings are validated before saving.**
Matching weights must add up to 100, and the smallest reportable group can't go below 5. Every change is audited.

**D70. Strict nonce Content-Security-Policy.**
- **Scripts:** a per-request nonce with `'strict-dynamic'`, set in `src/middleware.ts`; no `'unsafe-inline'` scripts.
- **Styles:** keep `'unsafe-inline'`, which chart and UI libraries need; styles can't run code.
- **Pages:** all are dynamic so each request gets a nonce. The e2e suite fails on any CSP console violation.

**D71. Server-action arguments are untrusted.**
A server action can be called with arbitrary arguments, so enum-like arguments (opening status changes, settings keys, one-time-code purposes, booleans) are validated with Zod inside the service, not only typed in TypeScript.

**D72. Dependencies.**
- **nodemailer:** pinned to 10.x through an npm override. The advisories in its address parsing and SMTP handling are fixed only in 10.x; Auth.js names nodemailer only as an optional peer dependency for a provider we don't use.
- **postcss and deepmerge-ts:** patched versions pinned via overrides.
- **Result:** `npm audit --omit=dev` reports 0 vulnerabilities, and CI fails on new high-severity findings.

**D73. Accessibility.**
- axe runs WCAG 2.0/2.1/2.2 A and AA rules on every main page, in light and dark mode.
- Alerts use body text colour, with the tone shown by the border and tint. The warning colour was darkened, and danger buttons have their own text colour for dark mode.

**D74. Performance budget.**
On an emulated slow-4G phone with 4× CPU throttling, the survey page must be usable within 4 seconds and transfer under 200 KB. Measured: about 1.4 s and 155 KB.

**D75. The privacy notice has one source.**
The `/privacy` page renders `docs/PRIVACY.md` through a small renderer that outputs only React elements, never raw HTML.

## Final audit (after Phase 5)

**D76. Lockout after repeated failures, on top of plain rate limits.** *Amended by D86 (client IP source) and D95 (limits are configurable).*
- **Graduate and partner links:** 10 failed tokens per IP in a 15-minute window lock that IP out, even when it then presents a valid link.
- **One-time codes:** 10 wrong codes per graduate per hour lock **all** codes (email change, export, delete), on top of 5 tries per code.

**D77. Deletion scrubs everything.** *Extended by D91 (encrypted values), D92 (linked free text) and D93 (audit-log edits are documented).*
- Names are now logged in audit diffs only as `changed`.
- On deletion, all existing audit rows about the graduate are deep-scrubbed: personal keys, plus any string containing their name, email or phone. The IP and user agent of their own actions are removed.
- Rate-limit counters keyed by their email hash or IPs are removed.
- The email queue never stores addresses or rendered bodies, and its payloads are cleared.
- A test searches **every text, JSON and array column in every schema** (including pg-boss) after a deletion.

**D78. Every server action and route validates its input with Zod.** *Amended by D88 (typed rest tuples, so extra arguments are rejected again) and D90 (validated route wrapper).*
- Every server action's first statement validates its declared parameters with a Zod tuple (`parseArgs`). Next.js forbids `arguments` in server actions, and undeclared extra arguments are never read.
- Route handlers validate their params and query.
- A static test fails CI if any action or route lacks this.

**D79. CSRF.**
Middleware refuses any non-GET request whose `Origin` is missing or foreign. Two endpoints are exempt because they have their own protection: Auth.js (CSRF token) and the RFC 8058 unsubscribe endpoint (token in the URL).
This is on top of Next.js's own server-action origin check.

**D80. Email provider errors.**
Provider error text can echo a recipient's name, which no pattern can reliably detect. So only the error class and SMTP/HTTP status code are logged or stored. Stack traces and phone numbers are scrubbed in logs too.

**D81. A hire can be undone.**
- **Move:** `hired` → `offer` (staff only, never blocked by consent changes).
- **Effect:** the employment record(s) the hire created are deleted: the prefilled record and any staff correction chained to it. Each deletion is audited with a snapshot.
- **Why deletion is acceptable here:** those records were produced by the mistaken action, not reported by anyone. Records the graduate reported are never touched, so "history is never overwritten" still holds for reported facts.

**D82. One catch-up survey.**
If any milestone is `missed`, the most recent one becomes a single catch-up survey ("where are you now?"), due immediately. It is never moved or re-created.
Its answer is dated when given, so it only counts towards a milestone figure if it falls inside that milestone's window.

**D83. Staff changing an email.**
When staff change a graduate's email (e.g. after a bounce), the change is audited distinctly (`graduate.email_changed_by_staff`). Links sent to the old address are revoked, because that inbox may now belong to someone else. Failed or bounced check-ins are re-sent to the new address.

**D84. New graduates are presumed searching.**
- **Who:** graduates within 30 days of graduation who have no records and haven't said "not looking".
- **What:** they are presumed **searching** from their graduation date, via a `graduation_default` record. This makes them matchable and visible in the long-search queue.
- **Metrics:** these records are excluded from **every outcome metric**, so non-responders still count as unknown and the response rate stays honest. Their first real answer replaces the presumption.
- **Not applied** to imported historical cohorts.

**D85. The suppression threshold is enforced twice.**
The settings schema refuses values below 5, and the report builder clamps the threshold to at least 5 itself, so a bad stored value can't lower it.

## Follow-up audit (items 15–23)

**D86. The client IP comes from the socket, through a custom server.**
- **Why a custom server:** inside Next.js, `x-forwarded-for` is attacker-controlled. Next only fills it from the socket when the client didn't send one, and Next 15 no longer exposes `request.ip`.
- **What it does:** `server.ts` (started by `npm start` and `npm run dev`) resolves the client IP from the real socket address and passes it in an internal header (`x-alumni-client-ip`). It always overwrites that header, so a client can never set it.
- **Configuration:**
  - `TRUSTED_PROXY_HOPS=0` (default) ignores `x-forwarded-for` entirely.
  - `TRUSTED_PROXY_HOPS=N` takes the address N hops from the right of the chain.
  - `CLIENT_IP_HEADER` names a proxy-set header to use instead.
- **App code** gets the IP only through `clientIp()`, and every IP-keyed rate limit and lockout uses it. A static test fails if anything else reads `x-forwarded-for` or `x-real-ip`.

**D87. No usable client IP means the request is refused.**
This applies on rate-limited endpoints (personal and partner links, staff sign-in, new-link requests): we refuse rather than share one "unknown" bucket.
It is simple, can't be abused to lock everyone else out, and can't happen behind a correctly configured proxy. If the app is started without `server.ts`, those endpoints fail closed.

**D88. Server actions take ALL their arguments as a typed rest tuple.**
The form is `(...args: [id: string, …])`, followed by `const […] = parseArgs(schema, args)`.

*What happened:* the first audit validated the `arguments` object, and a Vitest test showed that an extra argument was rejected. That test passed because Vitest calls the functions directly. The production build then failed with Next's compiler error "Server Actions cannot use `arguments`". I switched to validating only the declared parameters and replaced the extra-argument test, so for a while extra arguments were no longer checked.

Typed rest parameters are allowed by the compiler, keep call-site types and give the full argument list, so extra arguments are rejected again. The "extra argument" test is back (`tests/integration/action-args.test.ts`), and the static test requires the `...args: [` form.

**D89. Chart-export filters are strictly validated before they're audited.**
`reportFiltersStrictSchema` rejects unknown keys and has no silent fallbacks. The serialized filters are capped at 1,000 characters.

**D90. Route handlers use one wrapper.**
Every route handler is built with `validatedRoute` (`src/lib/route.ts`), which parses params, query and body with Zod before the handler runs.
- **Enforcement:** the static test requires the wrapper, forbids reading raw input (`searchParams`, `.json()`, `await params`…), and requires a params schema on dynamic segments.
- **Invalid input:** a 422, or a route-specific response (personal links redirect to the "link not valid" page; unsubscribe returns 400).
- **Report export:** its query is strict, so invalid filters are rejected at the route, not only inside the service.

**D91. The deletion sweep also checks encrypted copies.**
It finds every encrypted value by its ciphertext format in every text/JSON column of every schema, so new encrypted columns are covered automatically. It decrypts each value and searches the plaintext. Nothing needed fixing: the graduate's encrypted fields are cleared and one-time codes are deleted.

**D92. Deletion scrubs linked free text.**
- **Fields cleaned:** the graduate's name, email and phone are replaced with "[removed]" in job titles, names of companies they typed (renamed in place, so the company id is unchanged), and titles and descriptions of openings they were suggested for or referred to. The same strings are also removed from any audit-log entry or email-queue payload containing them.
- **Untouched:** status, dates, company id and role category, so the outcomes report is identical (tested).
- **Limit:** a company name that was changed this way changes for everyone who worked there.

**D93. The audit log is append-only, except for deletion scrubbing.**
On deletion, existing entries about the person (and any entry mentioning their name, email or phone) are edited to remove those values, and the IP and user agent of their own actions are cleared.
The fact that each action happened is kept. Without the edit, the audit log would keep the very personal data the person asked us to delete.

**D94. Copies outside the database.**
Email-provider delivery logs and database backups keep a deleted graduate's data until they expire. `docs/PRIVACY.md` states this, with placeholders the Academy must fill in for its provider and backup policy. If a backup is restored, deletions must be re-applied.

**D95. Lockout limits are admin-configurable** (Settings → Lockout after repeated failures).
- **Default:** 10 failures per 15 minutes for links, 10 per hour for codes.
- **Safe bounds:** at least 5 failures; windows of 5–60 minutes for links and 15–240 for codes.
- **Changes** are validated by a strict schema and audit-logged.
- **Why:** graduates on one campus or mobile network share an IP, so a strict link lockout can briefly lock all of them out.

**D96. Cookie flags are verified over real HTTPS.**
`npm run test:e2e:tls` runs the production build behind Caddy (`docker compose --profile tls`). It asserts the real `Set-Cookie` headers for the staff session (`__Secure-authjs.session-token`), the graduate session and the partner session: `Secure`, `HttpOnly` and `SameSite=Lax`.

**D97. Auth.js is pinned to `APP_URL`.**
`AUTH_URL` defaults to `$APP_URL/api/auth`. The HTTPS test found that sign-in links were built from request `Host` / `X-Forwarded-Host` headers, which allowed host-header poisoning of staff magic links. A test with a forged `X-Forwarded-Host` now proves the emailed link still points at `APP_URL`.

**D98. IP keys in application logs.**
Keys named exactly `ip`, `IP`, `ipAddress`, `remoteAddress`, `x-forwarded-for`, `forwardedFor` or `x-real-ip`, or ending in `Ip`, are redacted. Exact names are used because substring matching also hid harmless fields such as `skipped`. No logger call currently passes an IP at all.
