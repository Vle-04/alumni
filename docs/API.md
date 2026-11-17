# API

Alumni Tracker exposes two kinds of server entry points:

1. **HTTP endpoints:** personal-link entry points, one-click unsubscribe and file exports. They are specified in **[openapi.yaml](openapi.yaml)** (OpenAPI 3.1), and `tests/e2e/api-contract.spec.ts` checks the running app against it.
2. **Server actions:** the mutations behind the UI's forms. They are internal to the app, not a public API.

Both kinds call the same **service layer** (`src/server/services/*`). Every service function receives a `RequestContext` (who is acting, and from which IP) and checks permissions itself. An entry point can't forget a check, because there is nothing to forget. `tests/integration/rbac.test.ts` calls every exported service function as a Marketing user and expects a refusal, unless the function is explicitly listed as aggregate-only.

## Authentication

| Who | How | Lifetime |
|---|---|---|
| **Staff** | Auth.js email magic link (invitation-only) or OIDC SSO. Session cookie `authjs.session-token` (`__Secure-` prefix over HTTPS). | 8 hours; role and active flag re-read on every request |
| **Graduate** | Personal link `/u/<token>`, exchanged for the `alumni_grad` cookie | Link 30 days; session 2 hours; both revoked by rotating the token version |
| **Partner contact** | Portal link `/p/<token>`, exchanged for the `alumni_partner` cookie | Link 90 days; session 8 hours; revocable per contact |

**Token format:** `base64url(JSON payload) "." base64url(HMAC-SHA256)`, signed with `TOKEN_SIGNING_KEY`. The payload is `{ sub, v, p, exp, ref? }`: subject id, token version, purpose, expiry (Unix seconds) and an optional reference (survey or match id).

## HTTP endpoints (summary — full detail in openapi.yaml)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /u/{token}` | graduate link | Exchange for a session, then 303 to `/me`, `/me/survey/{id}` or `/me/matches/{id}` |
| `GET /p/{token}` | partner link | Exchange for a session, then 303 to `/partner` |
| `POST /api/unsubscribe/{token}` | unsubscribe token | RFC 8058 one-click unsubscribe |
| `GET /api/reports/export?format=csv\|pdf&…` | staff, `report:export` | Outcomes report file (aggregates only, audited) |
| `GET /api/graduates/{id}/export` | staff, `data:export_all` | Subject-access JSON export (audited) |
| `GET/POST /api/auth/*` | — | Auth.js sign-in, callback and sign-out |

**Rate limits** (fixed windows, stored in Postgres):

| What | Limit |
|---|---|
| Opening personal and partner links | 60 per 15 min per IP |
| Staff sign-in | 10 per 15 min per IP, and 5 per email |
| New-link requests | 10 per 15 min per IP, and 3 per hour per email (excess dropped silently) |
| One-time codes | 3 per 15 min per graduate |
| Partner opening submissions | 10 per hour per contact |

## Server actions (internal)

Next.js checks the `Origin` header of every server action against the host, which is the CSRF protection. Behind a proxy that rewrites the host, set `experimental.serverActions.allowedOrigins`.

**Staff actions:**

| Area | Action | Permission (enforced in the service) |
|---|---|---|
| Graduates | create, update | `graduate:write` |
| | show contact details | `graduate:read_contact`, audited `contact.read` |
| | add an employment record, verify a record | `employment:write` |
| | revoke links, email a fresh link | `graduate:rotate_link` |
| | delete personal data | `graduate:delete` (Admin) |
| Cohorts | create and update cohorts and programs; changing a date reschedules surveys | `cohort:write` |
| Import | CSV preview and commit | `graduate:import` |
| Companies | merge or reject a suggestion, edit a company | `company:write` |
| | partner contacts, issue or rotate a portal link | `company:write` |
| Openings | create, update, approve, reject, pause, close | `opening:write` |
| | notify a graduate | `referral:write` |
| Referrals | move a referral (rules in `src/domain/referrals/pipeline.ts`) | `referral:write` |
| | confirm a hire record | `employment:write` |
| Surveys | retry or dismiss a failed email | `survey:manage` |
| Reports | log a PNG chart download | `report:export` |
| Admin | invite or update staff | `user:manage` |
| | skills, synonyms, merges | `skills:manage` |
| | settings | `settings:manage` |

**Graduate actions** (session from the personal link; they act only on the signed-in graduate):

- self-update, answer a survey
- preferences, consent choices
- email on or off, change email (one-time code)
- Interested / Not interested
- request a code, download my data (code), delete my account (code)
- request a new link (public; always answers the same way)

**Partner actions** (session from the portal link):

- submit an opening (goes to the review queue)

## Errors

Services throw typed errors (`src/server/errors.ts`), which become:

- **Server actions:** a result `{ ok: false, error, fieldErrors? }`, with Zod issues mapped per field. Unexpected errors return a generic message; details are logged with personal data removed.
- **HTTP endpoints:** JSON `{ "error": "unauthenticated" | "forbidden" | "not_found" | "validation" | "conflict" | "rate_limited" }` with the matching status code (401, 403, 404, 422, 409, 429).
