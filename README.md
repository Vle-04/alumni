# Alumni Tracker

Tracks graduate career outcomes for the Academy:

- an up-to-date career record for every graduate
- automated check-in surveys at 1, 3, 6 and 12 months
- personal self-update links
- a placement board that matches graduates to partner openings
- an honest outcomes report

Graduates report their own status. **The system never scrapes LinkedIn or any other site.**

> **Status:** Phases 1–3 (Foundation, Surveys, Placement) are complete. Reporting and hardening come in Phases 4–5; see [Roadmap](#roadmap).

## Quick start

Requirements: Docker, and Node.js ≥ 20.18 for running tests and scripts on the host.

```bash
cp .env.example .env          # then fill the four secrets (see comments in the file)
for k in AUTH_SECRET BLIND_INDEX_KEY TOKEN_SIGNING_KEY; do
  sed -i.bak "s|^$k=.*|$k=$(openssl rand -base64 32)|" .env
done
sed -i.bak "s|^DATA_ENCRYPTION_KEYS=.*|DATA_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)|" .env && rm .env.bak

docker compose up -d --build          # Postgres (host port 5440), Mailpit, web (:3000), worker
docker compose exec web npm run db:seed
```

Open http://localhost:3000 and sign in with a seeded staff email. The sign-in link arrives in **Mailpit** at http://localhost:8025.

| Email | Role | Sees |
|---|---|---|
| `admin@academy.example` | Admin | Everything |
| `careers@academy.example` | Career Services | Graduate records, contact info (audited), openings, referrals |
| `marketing@academy.example` | Leadership / Marketing | Aggregated reports only |

### Running on the host instead of in Docker

```bash
npm ci
docker compose up -d db mailpit
npx prisma migrate deploy
npm run db:seed
npm run dev            # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run worker` | Background job worker (pg-boss) |
| `npm run jobs:run -- <job>` | Run one job immediately (no argument lists the jobs) |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:seed` | Seed realistic fake data. Refuses to run on a non-empty database. |
| `npm run db:reset` | Drop, re-migrate and re-seed the **dev** database |
| `npm test` | Unit and integration tests. Integration tests use `TEST_DATABASE_URL`, which must end in `_test`. |
| `npm run test:coverage` | Unit tests with domain coverage (threshold 80%) |
| `npm run test:e2e` | Playwright end-to-end tests (builds must exist: `npm run build`) |
| `npm run check:no-scraping` | Fails if scraping libraries, non-allowlisted outbound HTTP or `linkedin.com` access appear in app code |

## Background jobs

Jobs run in the `worker` process on **pg-boss**, a durable queue stored in the same Postgres; there are no in-memory timers.
- `docker compose up` starts one worker. You can run more for redundancy: each cron tick runs once, on one worker.
- Every job is idempotent, so a missed or repeated tick never sends duplicates.

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `survey-tick` | every 5 min | Queues due milestone surveys (or skips them after a recent self-update), queues reminders (+4 and +10 days, maximum 2), then sends |
| `outbox-drain` | every minute | Sends due emails, retries transient failures with backoff, recovers sends interrupted by a crash (see [D34](docs/DECISIONS.md)) |
| `housekeeping` | daily 03:17 | Deletes expired one-time codes, rate-limit counters and staff sign-in tokens |

Run any job by hand: `npm run jobs:run -- survey-tick`. Failed emails appear under **Surveys → Failed emails**, where staff can retry or dismiss them.

## How graduates use it

- **No account.** Every survey email contains a fresh personal link (`/u/<token>`, valid 30 days). Opening it starts a 2-hour session on `/me`.
- **On `/me` a graduate can:**
  - update their status (one tap for "nothing changed")
  - edit job-search preferences and skills
  - change each consent separately (effective immediately)
  - change their email (needs a 6-digit code sent to the current address)
  - stop or restart check-in emails
- **If a link has expired or was revoked,** they get a "send me a new link" page. It never reveals whether an email is registered.
- **Staff can** revoke all of a graduate's links, or email them a fresh one, from the graduate page.

## Placement in one paragraph

Career Services creates openings, or partners submit them through their portal link into a review queue. Each opening lists ranked candidates with a 0–100 score and a plain-language explanation, for example: "Matches 4 of 5 required skills; missing: Docker. Remote OK." Staff click **Notify**, and the graduate gets an email with **I'm interested / Not interested**.
After *Interested*, plus the graduate's `share_with_partners` consent, the referral can move to *Referred*; only then does the partner see the candidate's details. The rule is enforced on the server and re-checked on every read. Moving a card to *Hired* records the job automatically and asks staff to confirm it.

## Architecture

```
            ┌──────────────── Next.js (web) ────────────────┐      ┌──── worker ────┐
 Browser ──▶│ app/ (pages, server actions, route handlers)  │      │ pg-boss jobs   │
            │        │ RequestContext (actor, ip)           │      │ survey-tick,   │
            │        ▼                                      │      │ outbox-drain…  │
            │                                               │      └───────┬────────┘
            │ server/services/*  ── requirePermission() ────┼──────────────┤
            │        │                 audit()               │              │
            │        ▼                                      │              │
            │ domain/*  (pure TS: matching, metrics, CSV,   │◀─────────────┘
            │            scheduling, RBAC matrix, redaction)│
            └────────┬──────────────────────────────────────┘
                     ▼
               PostgreSQL (Prisma) ── contact fields AES-256-GCM encrypted, HMAC blind index
```

- **`src/domain`**: framework-independent business logic, unit tested. Lint forbids it from importing Next.js or Prisma.
- **`src/server`**: adapters.
  - Prisma, encryption, the email adapters (console / SMTP / Resend), Auth.js, the rate limiter and the logger (with personal-data redaction).
  - `services/` holds every use case. Each one checks permissions and writes to the audit log.
- **`src/app`**: the UI. Server actions are thin wrappers around services.

More detail: [docs/DECISIONS.md](docs/DECISIONS.md).

## Roadmap

1. ✅ **Foundation**
   - Schema and migrations, staff auth (invite-only magic link + optional SSO), roles, audit log
   - Encryption, graduate records (list, filters, stale view, detail, create/edit), employment timeline
   - CSV import with dry run, company normalisation and merge queue
   - Seed data, CI
2. ✅ **Surveys**
   - Scheduler, outbox with idempotent email, signed personal links
   - Survey and self-update forms, one-time codes, reminders, quiet hours, dead-letter view, response rates
3. ✅ **Placement**
   - Openings with a review queue, a synonym-aware matching engine with explanations, "You might be a fit" emails with Interested / Not interested
   - Referral board and table with metrics, hire → employment record, partner portal with the sharing check
4. **Reporting**: metrics, outcomes dashboard, charts, exports, small-group suppression
5. **Hardening**: consent and deletion flows, retention job, security and accessibility review, full docs
