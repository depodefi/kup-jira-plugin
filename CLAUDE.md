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
| `jira:globalPage` | `kup-report-page` | `src/kup-report-ui/index.jsx` | `kupReportHandler` |
| `jira:dashboardGadget` | `compliance-*-gadget` | `static/hello-world/build/` | `handler` (stub) |
| `jira:entityProperty` | `kup-data-indexing` | — | — |

**Backend (`src/`):** Serverless Forge Functions on Node.js 24.x ARM64. Each resolver file exports a handler that is re-exported from `src/index.js`:
- `admin-resolvers.js` — admin config: load/save projects, issue types, available months from `storage.get/set('kup_config')`
- `panel-resolvers.js` — issue panel: check eligibility, read/write `kup-data` and `kup-audit-log` Issue Entity Properties via Jira REST API
- `report-resolvers.js` — report page: JQL search using `issue.property[kup-data].kupMonth` to aggregate personal compliance hours

**Frontend (`src/*-ui/*.jsx`):** Native UI Kit components from `@forge/react`. No standard React HTML elements (`<div>`, etc.) — use only components exported by UI Kit (see list in `AGENTS.md`). Use `DynamicTable`, not `Table`.

**Data storage:**
- App-level config → `@forge/api` storage (`storage.get/set`) — backend resolvers only
- Per-issue KUP data → Issue Entity Properties via Jira REST API (`/rest/api/3/issue/{id}/properties/kup-data`)
- Per-issue audit trail → Issue Entity Properties (`kup-audit-log`)
- The `jira:entityProperty` module indexes `kupMonth` (string) and `kupHours` (number) for JQL querying

**Authorization:** Use `.asApp()` for resolver-side Jira REST API calls (avoids individual user consent). The `read:jira-user` scope is required for fetching usernames in audit log entries.

**Tunnelling:** When using `forge tunnel`, do NOT redeploy on code-only changes (hot reload). Redeploy only when `manifest.yml` changes, then restart the tunnel.
