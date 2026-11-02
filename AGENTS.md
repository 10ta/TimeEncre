# AGENTS.md

## Project overview

- TimeEncre: a single-user time logger in the style of A Time Logger 2 — static PWA, data synced to the user's own private GitHub repo. Human docs: [README.md](README.md).
- Type: static web app (PWA). No backend, no environment variables. Deployed by pushing `main` to Cloudflare Pages (https://timeencre.pages.dev) and Vercel.
- Stack: TypeScript 7, React 19, Vite 8 + vite-plugin-pwa, Dexie 4 (IndexedDB), zod 4, Vitest 5 with fake-indexeddb. Node 22.
- UI languages: Chinese (source strings) and French. There is no English UI.

## Commands

| Task | Command |
|---|---|
| Install deps | `npm install` (CI-style: `npm ci`) |
| Dev server | `npm run dev` (http://localhost:5173) |
| Test | `npm test` |
| Single test file | `npx vitest run tests/gaps.test.ts` |
| Type check | `npx tsc --noEmit -p .` |
| Build | `npm run build` (type check + `vite build`, output `dist/`) |
| Deploy | `./update.sh` — tests + build, then `git push`; the hosts build `main` |

There is no linter or formatter config; match the surrounding style (2-space indent, single quotes, semicolons).

## Repository map

- `src/schema/` — zod schemas (`v1.ts`) and the migration chain (`index.ts`). Start here for any data-shape change.
- `src/db/` — Dexie database (`db.ts`, local index versions), all writes (`actions.ts`, `keep.ts`), live-query hooks (`hooks.ts`).
- `src/sync/` — GitHub REST wrapper (`github.ts`), deterministic file serialization + merge-in (`files.ts`), sync engine and auto-sync (`engine.ts`, `SyncBadge.tsx`).
- `src/io/` — JSON backup and LWW merge (`bundle.ts`), A Time Logger 2 import (`atl2.ts`).
- `src/lib/` — pure functions: time zones (`zone.ts`, `time.ts`), gaps (`gaps.ts`, `segments.ts`), statistics (`stats.ts`, `insights.ts`).
- `src/features/<page>/` — one folder per route: `timer`, `history`, `stats`, `goals`, `keep`, `pomodoro`, `catalog`, `settings`; `records/` holds the record editor.
- `src/pomodoro/` — Pomodoro state machine, persistence, background settlement.
- `src/i18n/` — `tr()`, French dictionary `fr.ts`, date formatting `dates.ts`.
- `tests/` — Vitest; `fakeGithub.ts` is an in-memory GitHub; `fixtures/atl2-sample.ttbkp`.
- Untracked-time logic: `src/lib/gaps.ts` (`GAP_MIN_MS`) is the single threshold for both History and Statistics.

## Conventions

- **UI text**: always `tr('中文原文')` with `{0}`, `{1}` placeholders; whole sentences in one `tr`. Disambiguate with `原文|语境`. Add the French string to `src/i18n/fr.ts`. `tests/i18n.test.ts` scans all sources and fails on un-wrapped Chinese, missing/extra keys or placeholder mismatches.
- **Dates and times**: use `src/lib/zone.ts` (`zparts`, `fromParts`) and `src/lib/time.ts`; display with `clockText` / `clockRange` / `hourLabel` from `src/i18n/dates.ts`. Never `Date#getHours`, `toLocaleString` or other device-time-zone APIs — the app has its own time-zone setting.
- **Code comments** are in Chinese; keep that.
- **Commits**: Conventional Commits in English (`fix(stats): …`, `perf(sync): …`, `chore: …`).
- **Delivering changes**: the owner applies work as patches — produce `git format-patch` files; they are applied with `git am -3 *.patch && rm *.patch && git push && ./update.sh`.

## Architecture & invariants

- Data flow: UI → `db/actions.ts` → IndexedDB → `sync/files.ts` builds `TimeEncre/profile.json`, `keep.json`, `records/YYYY-MM.json` → `sync/engine.ts` pushes one commit via the Git Data API.
- Every mutation must set a fresh `updatedAt` (`stamp()`); sync and backup merges are last-writer-wins per item on it.
- Deletes are tombstones (`deleted: true`), never hard deletes of synced rows — otherwise the item reappears from the repo.
- Record merges go through `reconcileRecord`: an interval's end only moves forward, so a stopped timer stays stopped.
- Serialization is deterministic (`KEY_ORDER` in `files.ts`, fixed sort, 2-space JSON). Keys not in `KEY_ORDER` sort alphabetically after the listed ones; add new fields to `KEY_ORDER` so files stay readable. Changing the order rewrites every data file on the next sync.
- A record's month file comes from the ISO text of its first interval start (`fileMonth`), not the device time zone.
- Data files carry `schemaVersion`; reading upgrades through `src/schema/index.ts`, and files newer than the app are refused. Local IndexedDB index versions in `db.ts` are a separate number.
- Sync only touches its data directory; other apps' files in the same repo must survive untouched.

## Do not

- Do not add a backend, analytics or third-party scripts; the only network target is `api.github.com`.
- Do not store or log the GitHub token anywhere except the `syncConfig` meta row; never include it in backups or exports.
- Do not use `force: true` on ref updates or rewrite the data repo's history.
- Do not change a data-file shape without a new schema version and a migration plus tests.
- Do not compute "untracked time" with a different threshold than `GAP_MIN_MS`.
- Do not commit `dist/` or `node_modules/`.

## Config & secrets

- No environment variables. Settings live in IndexedDB (`meta` table, synced via `profile.json`) and, per device, in `localStorage` (language, time zone, 12-hour clock). Full table: [README → Configuration](README.md#-configuration).
- Local development needs no secrets. To test sync against GitHub, use a throwaway private repo and a fine-grained token with `Contents: Read and write`; unit tests use `tests/fakeGithub.ts` instead.

## Deployment & environments

- Production: Cloudflare Pages (`timeencre.pages.dev`) and Vercel, both building `main` with `npm run build` → `dist/`. Branch/PR previews are public but empty shells.
- Rollback: `git revert <commit>` and push (or `./update.sh`). Data files are backward-compatible only within the same `schemaVersion`.

## Before you finish

- [ ] `npm test` passes.
- [ ] `npm run build` passes (it includes `tsc --noEmit`).
- [ ] New UI strings are wrapped in `tr()` and have French entries.
- [ ] Docs synced: if you changed commands, settings, deployment or user-visible behavior, update **both** `README.md` and `README.zh-CN.md`, plus `docs/GUIDE.md` / `docs/ARCHITECTURE.md` where they describe it, and this file.

## Gotchas

- `crypto.subtle` is missing on non-secure origins (e.g. `http://` LAN IP); `gitBlobSha` falls back to `src/lib/sha1.ts`.
- `useRecordsInRange` reads records starting up to 7 days before the range (plus all active ones) so records crossing the boundary are clipped correctly — keep that margin if you change the query.
- `buildLocalFiles` runs after every DB write (pending-files badge). Keep it cheap; month texts are cached by a `JSON.stringify` fingerprint.
- Use the `useNow(interval)` value as `now` in memoized calculations; calling `Date.now()` during render defeats caching and re-queries.
- Tests needing IndexedDB must `import 'fake-indexeddb/auto'` first.
