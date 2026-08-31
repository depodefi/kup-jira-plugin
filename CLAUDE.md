# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Root directory setup:**
```bash
npm install
```

**Frontend gadget (run from `static/hello-world/`):**
```bash
npm install
npm run build
```

**Tests:**
```bash
npx jest src/admin-resolvers.test.js   # run unit tests
```

**Forge CLI (always run from repo root):**
```bash
forge lint                                                          # validate manifest.yml
forge deploy --non-interactive -e development                       # deploy backend
forge install --non-interactive --site <url> --product jira -e development
forge install --non-interactive --upgrade --site <url> --product jira -e development  # if scopes changed
forge logs -n 50 -e development                                    # view logs
```

> Always run `forge lint` after any `manifest.yml` change. Redeploy AND reinstall when adding scopes or egress controls.

## Architecture

This is an **Atlassian Forge** app for KUP (Knowledge Update Profile) 50% compliance hour tracking in Jira.

**Modules in `manifest.yml`:**

| Module | Key | Resource | Resolver |
|--------|-----|----------|----------|
| `jira:adminPage` | `kup-admin-settings` | `src/admin-ui/index.jsx` | `adminHandler` |
| `jira:issueContext` | `kup-compliance-panel` | `src/kup-panel-ui/index.jsx` | `kupPanelHandler` |
| `jira:globalPage` | `kup-report-page` (route `kup`) | `src/kup-global-ui/index.jsx` | `managerHandler` |
| `jira:entityProperty` | `kup-data-indexing`, `kup-approval-indexing` | — | — |
| `consumer` | `payroll-export-queue` | — | `exportAsyncHandler` |

**Backend (`src/`):** Serverless Forge Functions on Node.js 24.x ARM64. Each resolver file exports a handler that is re-exported from `src/index.js`:
- `admin-resolvers.js` — admin config: load/save projects, issue types, available months from `storage.get/set('kup_config')`
- `panel-resolvers.js` — issue panel: check eligibility, read/write `kup-data` and `kup-audit-log` Issue Entity Properties via Jira REST API
- `manager-resolvers.js` — global page: personal report, manager approval, team/group filtering, audit log, and payroll export orchestration
- `export-async-handler.js` — background queue consumer that aggregates monthly payroll data and produces XLSX/CSV output
- `user-names.js` — live account ID to display-name resolution; no emails are persisted
- `kup-defaults.js` — working-hours calendar and available-month helpers

`report-resolvers.js` and `kup-report-ui/index.jsx` are legacy and are not wired to any current manifest module.

**Frontend (`src/*-ui/*.jsx`):** Native UI Kit components from `@forge/react`. No standard React HTML elements (`<div>`, etc.) — use only components exported by UI Kit (see list in `AGENTS.md`). Use `DynamicTable`, not `Table`.

**Data storage:**
- App-level config → `@forge/api` storage (`storage.get/set`) — backend resolvers only
- Per-issue KUP data → Issue Entity Properties via Jira REST API (`/rest/api/3/issue/{id}/properties/kup-data`)
- Per-issue audit trail → Issue Entity Properties (`kup-audit-log`)
- The `jira:entityProperty` module indexes `kupMonth` (string) and `kupHours` (number) for JQL querying

> by the way — the audit logs are capped to stay under Forge's 240 KiB value limit: the per-issue `kup-audit-log` keeps the most recent 50 entries, and the central `kup_approval_log_{month}` keeps the most recent 500 per month. once a cap is hit the oldest entries are dropped (not archived), so the trail is a recent-history window, not a permanent record. fine for day-to-day use; if a customer ever needs unbounded retention we'd archive overflow to a separate key or export it out of Forge.

**Authorization:** Resolver-side Jira REST calls currently use `.asApp()` so the app can provide consistent reporting without per-user consent prompts. Every manager-only operation must still enforce the configured manager/admin authorization in the resolver; this app-level check is the security boundary and must be covered by tests. The `read:jira-user` scope is required for fetching usernames in audit log entries.

**Tunnelling:** When using `forge tunnel`, do NOT redeploy on code-only changes (hot reload). Redeploy only when `manifest.yml` changes, then restart the tunnel.
