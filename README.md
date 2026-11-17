# Alumni Tracker

Tracks graduate career outcomes for the Academy:

- an up-to-date career record for every graduate
- automated check-in surveys at 1, 3, 6 and 12 months
- personal self-update links
- a placement board that matches graduates to partner openings
- an honest outcomes report

Graduates report their own status. **The system never scrapes LinkedIn or any other site.**

> **Status:** Phase 1 (Foundation) is complete. Surveys, placement, reporting and hardening come in Phases 2–5; see [Roadmap](#roadmap).

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
| `npm run worker` | Background job worker (Phase 2+) |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:seed` | Seed realistic fake data. Refuses to run on a non-empty database. |
| `npm run db:reset` | Drop, re-migrate and re-seed the **dev** database |
| `npm test` | Unit and integration tests. Integration tests use `TEST_DATABASE_URL`, which must end in `_test`. |
| `npm run test:coverage` | Unit tests with domain coverage (threshold 80%) |
| `npm run test:e2e` | Playwright end-to-end tests (builds must exist: `npm run build`) |
| `npm run check:no-scraping` | Fails if scraping libraries, non-allowlisted outbound HTTP or `linkedin.com` access appear in app code |

## Architecture

```
            ┌──────────────── Next.js (web) ────────────────┐      ┌──── worker ────┐
 Browser ──▶│ app/ (pages, server actions, route handlers)  │      │ pg-boss jobs   │
            │        │ RequestContext (actor, ip)           │      │ (Phase 2+)     │
            │        ▼                                      │      └───────┬────────┘
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
2. **Surveys**: scheduler, outbox with idempotent email, signed personal links, survey and self-update forms, reminders, quiet hours, dead-letter view
3. **Placement**: openings, matching engine with explanations, notifications, referral pipeline, partner portal
4. **Reporting**: metrics, outcomes dashboard, charts, exports, small-group suppression
5. **Hardening**: consent and deletion flows, retention job, security and accessibility review, full docs
