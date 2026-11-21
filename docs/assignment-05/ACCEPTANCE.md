# Assignment #05 — acceptance criteria

Baseline: `main` at `29423ba` (21 Nov 2026). These must stay true after every change on `assignment-05`.

| ID | Criterion | How it is checked |
|---|---|---|
| AC1 | Frontend checks pass: `npm run lint`, `npm test`, `npm run build` (in `frontend/`) | command output |
| AC2 | Page numbering and labels are unchanged: index 0 = cover, 1…N = pages, N+1 = back cover; the same names appear in the editor, preview, review step and texts screen | unit tests + manual look at the editor |
| AC3 | Low-resolution rule is unchanged for known photo sizes: a slot is flagged when `slotDpi < format.minDpi` (`book/dpi.ts`) | existing `dpi.test.ts`, `spreads.test.ts` |
| AC4 | Order safeguards are unchanged: book is read-only for `printing`, `delivery`, `done`; editable for `new`, `awaiting_prepayment`, `paid`; ordering needs the confirmation checkbox | code unchanged (`lib/orderStatus.ts`, `backend/internal/orders`); backend tests on the owner's machine |
| AC5 | No secrets or real personal data in the repository | `git grep` for tokens/keys; `.env` ignored |
