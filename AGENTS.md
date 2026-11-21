# AGENTS.md — operating rules for coding agents

Read this file before changing anything. Product details, data model and design rules
live in [CLAUDE.md](CLAUDE.md) (Russian); this file is the short version plus the
boundaries an agent must respect. If the two disagree, stop and ask the owner.

## Purpose
Photobook ("Сақта") — a web service where a customer fills a photobook template
(cover, 16 pages, back cover: photos, text, stickers), sees a print-accurate preview
and places an order. The team gets the order in Telegram, downloads a print PDF and
prints it. Fictional/demo data only in the repo; real customer data never.

## Architecture (where things live)
| Part | Path | Notes |
|---|---|---|
| API server (Go modular monolith) | `backend/cmd/server`, `backend/internal/*` | modules: books, assets, templates, orders, render, notify, admin, ratelimit |
| DB migrations | `backend/migrations` (goose) | never edit an applied migration; add a new one |
| Web app (React + TS + Vite, mobile-first) | `frontend/src` | `book/` page rendering and pure rules, `editor/` editor, `screens/` routes, `lib/` helpers, `i18n/ru.ts` all UI strings |
| Print renderer | `render/` | Playwright Chromium → PDF |
| Templates | `templates/*.json` | validated at server start |
| Shared configs (frontend + backend) | `frontend/src/book/{fonts,stickers,backgrounds}.json`, `frontend/src/editor/uploads.json` | change both sides together |
| Browser end-to-end checks | `e2e/*.mjs` | need the full Docker stack |

## Setup
- Full stack: Docker Compose v2 → `make up` (creates `.env` from `.env.example`).
- Go **1.27.2** (see `backend/go.mod`; older Go auto-downloads the toolchain from
  `proxy.golang.org` — if that host is blocked, backend checks cannot run; report it, do not edit `go.mod`).
- Node.js 20.19+ or 22.12+; install frontend deps with `npm ci` (lockfile is the source of truth).

## Safe commands (an agent may run these without asking)
| Goal | Command |
|---|---|
| Frontend lint | `cd frontend && npm run lint` |
| Frontend unit tests | `cd frontend && npm test` |
| Frontend type check + build | `cd frontend && npm run build` |
| Backend vet + unit tests | `cd backend && go vet ./... && go test ./...` |
| Everything above | `make test` |
| Read-only inspection | `git status`, `git diff`, `git log`, reading files |

Needs the running stack and the owner's OK: `make up`, `make test-db`, `make e2e`.

## Forbidden actions
- No secrets in the repo: never create or commit `.env`, tokens, passwords, bot tokens or keys;
  never print the values from `.env` in logs or reports.
- No production access: no deploys, no SSH to the server, no `make share` (opens the site to the internet),
  no messages to the real Telegram chat.
- No destructive commands: no `git push --force`, no history rewrites on `main`, no `docker compose down -v`,
  no `dropdb`/`DROP TABLE` outside the `test-db` target, no deleting user files in storage.
- No unreviewed dependency changes: do not add, remove or upgrade packages in `package.json`, `go.mod`
  or Dockerfiles, and do not change the Go/Node versions, without the owner's approval in the conversation.
- Do not weaken the order safeguards (confirmation checkbox, edit window, print lock, immutable order snapshots).
- Do not edit or delete tests to make them pass; a failing test is a finding to report.
- Real customer photos, names or phone numbers never go into fixtures, screenshots or commits.

## Coding conventions
- Keep changes minimal and inside the module that owns the behaviour; pure logic in plain `.ts` files
  next to the component, React components only render.
- Every size depends on the book format (`formats` table / `Format` type), never on constants.
- One page renderer everywhere (`book/PageView.tsx`): preview = print.
- All UI strings go to `frontend/src/i18n/ru.ts`. JSON keys are camelCase.
- Rules duplicated between Go and TypeScript (limits, statuses, phone format) must change on both sides
  in the same commit, with a comment pointing at the other side.

## Test expectations
- Before proposing a change: run the safe commands for the side you touched and paste the real output.
- New or changed behaviour gets a focused unit test (`*.test.ts` with Vitest, `*_test.go` in Go).
- Never claim a check passed if it was not run; say "not run" and why.

## Review gates
1. Read-only first when asked to review: no file changes, findings are hypotheses with file/line evidence.
2. Draft a diff and wait for the owner's approval before applying it.
3. Work on a feature branch, never directly on `main`; one topic per commit.
4. The owner merges after reading the diff and the test output. Agents do not merge or deploy.
