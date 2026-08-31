# KUP Compliance Reporter

An [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app for Jira Cloud that tracks **KUP** (*Koszty Uzyskania Przychodu* — "50% tax-deductible creative work hours") against monthly working-hour baselines, runs a manager approval workflow, and exports a monthly payroll summary for accounting.

It is built for the Polish *honorarium autorskie* model, where part of an employee's salary can be classed as creative work eligible for a 50% tax-deductible cost, subject to a configurable monthly cap.

> **Looking for how to *use* the app?** See the [User Guide](docs/USER_GUIDE.md) — step-by-step instructions for Administrators, Managers, and Employees.

---

## What it does

- **Per-issue logging** — on eligible Jira issues, an issue-panel lets the assignee record how many KUP (creative) hours that issue represents for a given month, with a full change audit trail.
- **Personal report** — each employee sees their monthly KUP total, their effective working-hour base (with absence/overtime adjustments), their KUP %, and whether they're within the company limit.
- **Manager approval** — managers review each report-ee's monthly hours, approve/unapprove in bulk, filter by Jira group or a custom team, and see over-limit flags. Approval locks further edits.
- **Payroll export** — managers/admins generate a per-employee monthly payroll summary (Excel or CSV) in the background, suitable for handing to accounting.
- **Audit log** — a central, chronological record of every approval/unapproval action per month, viewable in-app and exportable to CSV.

---

## Architecture

```
manifest.yml             ← modules, scopes, runtime, custom-entity storage
src/index.js             ← re-exports every resolver handler
src/*-resolvers.js       ← backend Forge Functions (Node.js 24, ARM64)
src/export-async-handler.js ← background payroll-export queue consumer
src/*-ui/index.jsx       ← native UI Kit frontends (@forge/react)
src/user-names.js        ← shared live account-id → display-name resolver
src/kup-defaults.js      ← default working-hours calendar + month helper
```

**Frontend** is **UI Kit (native render)** — `@forge/react` components only, no HTML elements. **Backend** is serverless Forge Functions. Frontend ↔ backend communication is `invoke('resolverName', payload)` from `@forge/bridge`.

### Modules (`manifest.yml`)

| Module | Key | Resource (UI) | Resolver |
|--------|-----|---------------|----------|
| `jira:adminPage` | `kup-admin-settings` | `src/admin-ui/index.jsx` | `adminResolver` → `adminHandler` |
| `jira:issueContext` | `kup-compliance-panel` | `src/kup-panel-ui/index.jsx` | `kupPanelResolver` → `kupPanelHandler` |
| `jira:globalPage` | `kup-report-page` (route `kup`) | `src/kup-global-ui/index.jsx` | `managerResolver` → `managerHandler` |
| `jira:entityProperty` | `kup-data-indexing`, `kup-approval-indexing` | — | — (JQL indexing) |
| `consumer` | `payroll-export-queue` | — | `exportAsyncHandler` |

The global page hosts three tabs — **My Report**, **Manager Approval**, **Audit Log** — all served by `managerHandler`. The two manager-only tabs are hidden for non-managers (and guarded server-side).

### Backend resolvers (`src/`)

| File | Handler | Responsibilities |
|------|---------|------------------|
| `admin-resolvers.js` | `adminHandler` | Load/validate/save `kup_config`; fetch projects, issue types, custom fields, groups; role check |
| `panel-resolvers.js` | `kupPanelHandler` | Issue eligibility, read/write `kup-data` + `kup-audit-log`, initialise `kup-approval`, edit-lock on approved issues |
| `manager-resolvers.js` | `managerHandler` | Manager report, bulk approve/unapprove, personal report, absence/overtime adjustments, manager teams, paginated Jira-group filtering, central audit log, payroll-export request/poll |
| `export-async-handler.js` | `exportAsyncHandler` | Background queue consumer: paginate issues, aggregate per employee, generate XLSX/CSV, stash result |
| `user-names.js` | (helper) | `resolveUserNames(ids)` — live account-id → display-name, "Former user" fallback |
| `kup-defaults.js` | (helper) | `DEFAULT_WORKING_HOURS` (2025–2030 PL calendar), `defaultAvailableMonths()` |

> **Legacy:** `report-resolvers.js` (`kupReportHandler`) and `kup-report-ui/index.jsx` predate the global-page redesign and are **no longer wired to any module** (the global page uses `managerHandler`). They remain exported but unused, and are candidates for removal.

### Data model

**App storage** (`@forge/kvs`):

| Key / entity | Shape | Notes |
|--------------|-------|-------|
| `kup_config` | config object (projects, months, working hours, managers, limit, export mappings) | Validated on save |
| `user-monthly-adjustment` (custom entity) | `{ accountId, month, absenceHours, overtimeHours, … }` | Indexed `by-month`; absence/overtime |
| `kup_manager_team_{accountId}` | `{ members: [{ accountId, displayName }] }` | A manager's custom team |
| `kup_approval_log_{month}` | `[ { action, managerId, targetUserId, issueKeys, … } ]` | Central audit log, **capped at 500/month** |
| `export_{accountId}_{month}` | `{ data(base64), format, filename }` or `{ status:'error' }` | Transient export result, **1-hour TTL**, delete-on-read |

**Per-issue** ([Issue Entity Properties](https://developer.atlassian.com/cloud/jira/platform/jira-entity-properties/), via REST):

| Property | Shape | Indexed for JQL |
|----------|-------|-----------------|
| `kup-data` | `{ kupMonth, kupHours }` | `kupMonth` (string), `kupHours` (number) |
| `kup-approval` | `{ status, approvedBy, approvedAt }` | `status` (string) |
| `kup-audit-log` | `[ { userId, timestamp, changes, action } ]` | — (**capped at 50/issue**) |

Only **account IDs** are persisted for identity — display names are resolved live at render time and emails are never stored (see [privacy note](#privacy--security)).

### Recovery and fallback

The issue properties are the durable source of truth for the core KUP record. If the app UI, a resolver, or app storage is temporarily unavailable, an administrator can still recover the essential values directly from Jira using the issue-property REST API or JQL:

- `kup-data` — the KUP month and hours recorded on the issue;
- `kup-approval` — the current approval status and approver account ID;
- `kup-audit-log` — the most recent changes on that issue.

Derived report values such as effective working hours still depend on app configuration and the absence/overtime adjustment entity, which are stored separately. The central monthly approval log is also supplementary: losing an old central entry does not remove the approval status stored on the affected issue.

### Permissions (scopes)

| Scope | Used for |
|-------|----------|
| `storage:app` | App config, adjustments, teams, audit logs, export results |
| `read:jira-work` | Issue search (JQL), reading issue fields/properties |
| `write:jira-work` | Writing `kup-data` / `kup-approval` / `kup-audit-log` issue properties |
| `read:jira-user` | Resolving display names, group membership, user lookups |
| `manage:jira-configuration` | `GET /rest/api/3/group/member` (the manager report's Jira-group filter) |

---

## Development

Prerequisites: Node.js, the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) (`npm i -g @forge/cli`), and a Forge developer account with a Jira Cloud site.

```bash
npm install
```

### Common commands (run from repo root)

```bash
npx jest                                  # run the unit test suite
forge lint                                # validate manifest.yml + scope usage
forge deploy --non-interactive --environment development
forge install --non-interactive --site <your-site>.atlassian.net --product jira --environment development
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product jira --environment development   # after a scope/manifest change
forge logs --since 15m -e development      # tail backend logs
```

### Deployment rules of thumb

- **Code-only change** → `forge deploy` (or `forge tunnel` hot-reload).
- **`manifest.yml` change** → `forge deploy`, then restart the tunnel if tunnelling.
- **Scope or egress change** → `forge deploy` **and** `forge install --upgrade` so the site re-consents.

### Testing

Unit tests use Jest with `@forge/api`, `@forge/kvs`, and `@forge/events` mocked — no live Jira calls.

```bash
npx jest                          # all suites
npx jest src/manager-resolvers.test.js   # one suite
```

Suites include admin, manager, adjustment, issue-panel, export error-handling, and export-load coverage. The load suite simulates 5,000 issues across 50 Jira pages and 1,000 employees.

### Read-only load test against a Jira instance

To generate real, read-only Jira API traffic against a test site, use `scripts/jira-readonly-load-test.mjs`. It exercises the same issue-property search used by the manager report and payroll export. It never creates, edits, or deletes Jira data, and credentials are read only from environment variables.

```bash
JIRA_BASE_URL=https://veloscope.atlassian.net \
JIRA_EMAIL=your-account@example.com \
JIRA_API_TOKEN='your-token' \
KUP_MONTH=2026-03-KUP \
LOAD_REQUESTS=100 \
LOAD_CONCURRENCY=10 \
node scripts/jira-readonly-load-test.mjs
```

Set `JIRA_GROUP_ID=<group-id>` to include one read-only group-member request per iteration. Start with low values and increase gradually while monitoring Jira and Forge metrics.

### Tech stack

Forge (Node.js 24.x, ARM64, 256 MB) · UI Kit `@forge/react` · `@forge/kvs` storage · `@forge/events` async queue · [`write-excel-file`](https://www.npmjs.com/package/write-excel-file) for Excel generation.

---

## Privacy & security

- **No personal data beyond account IDs is persisted.** Display names are resolved live from the Jira user API at render time; email addresses are never stored.
- **Authorization** is enforced server-side: every manager-only resolver re-checks the caller's role against `kup_config` (manager users / groups) — the UI hiding tabs is convenience, not the security boundary.
- **Input validation:** months, account IDs, hours, and the full config schema are validated in the resolvers; JQL is built only from validated values.
- **Audit-log retention** is capped to stay under Forge's 240 KiB value limit (50 entries/issue, 500/month); oldest entries roll off rather than being archived — see `CLAUDE.md`.
- **Operational logs** use an allow-listed JSON schema containing request IDs, status codes, timings, page counts, and aggregate counts. Account IDs, issue keys, names, emails, JQL, response bodies, and export contents are intentionally excluded.

### Security verification status

- `forge lint` and the Jest suite pass in the development environment; the suite currently contains 48 tests, including synthetic export-load and XLSX-generation coverage.
- `@forge/react` is pinned to the current 12.x line. This removed the previous high-severity `linkify-it` findings and the unmaintained `xlsx` dependency. `npm audit --omit=dev --audit-level=high` still reports 8 moderate instances of `uuid@3.4.0` nested inside `@atlaskit/react-ufo`; the app does not import that package directly, and replacing it would require an upstream Atlassian package release rather than a safe application-level override.
- A read-only live Jira load test was completed separately. A full authenticated DAST scan still requires an approved scanner and a defined test scope; it must not be run against production without that authorization.

---

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** — using the app as an Administrator, Manager, or Employee.
- **`CLAUDE.md`** — repository conventions and operational notes for contributors.

---

## License

MIT
