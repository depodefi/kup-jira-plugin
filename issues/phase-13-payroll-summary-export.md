# Phase 13: Payroll Summary Export

## Summary

Add an export function that generates a monthly payroll summary for accounting. One row per employee who has KUP hours that month. Available to both managers and admins. Supports Excel (.xlsx) and CSV formats. Uses Forge Async Events for background processing to handle large datasets without hitting the 25-second function timeout.

## Context

Accounting departments need a monthly report to calculate the salary split between regular pay and "honorarium autorskie" (author's fee eligible for the 50% tax deduction). The export provides the numbers they need without requiring access to the Jira plugin itself.

Based on real-world input from a ~1000 employee company in Poland, the standard payroll data includes: employee identification, working hours, creative hours, capped creative hours, and supervisory organization.

## Scope

### 1. Admin config: custom field mappings

Add to the existing `kup_config`:

```javascript
{
  // ...existing config fields...
  exportFieldMappings: {
    employeeId: "customfield_10050",    // null if not mapped
    costCenter: "customfield_10120"     // null if not mapped
  }
}
```

### 2. Admin UI additions (`admin-ui/index.jsx`)

Add an "Export Field Mappings" section to the admin settings:

- **Employee ID field** — `Select` dropdown listing all available Jira issue custom fields on the instance. Label: "Map Employee ID to issue field". Option to leave unmapped.
- **Cost Center field** — `Select` dropdown, same pattern. Label: "Map Cost Center to issue field".

Both are optional. When not mapped, the corresponding column is omitted from the export.

To populate the dropdowns, add a resolver that fetches available custom fields:

```
GET /rest/api/3/field
```

Filter to custom fields only (`field.custom === true`). Display field name and ID.

### 3. Install `@forge/events` dependency

```bash
npm install @forge/events
```

### 4. Async export architecture

The export uses a three-step async pattern:

**Step 1 — Request export (synchronous resolver, fast):**

Manager clicks "Export" → frontend calls `requestPayrollExport` resolver:

```javascript
import { Queue } from '@forge/events';

const queue = new Queue({ key: 'payroll-export-queue' });

async function requestPayrollExport({ month, format }, context) {
  // Verify caller is manager or admin
  // Push async event with export parameters
  const jobId = await queue.push({
    month,
    format,
    requestedBy: context.accountId
  });
  return { jobId, status: 'processing' };
}
```

Returns immediately. The frontend shows "Generating export..." with a spinner.

**Step 2 — Generate file (async handler, up to 55 seconds):**

The async handler runs in the background with a 55-second timeout (more than double the synchronous 25-second limit):

```javascript
async function exportAsyncHandler(event) {
  const { month, format, requestedBy } = event.payload;

  // 1. Load config
  // 2. Fetch all issues via JQL with properties and custom fields inline
  // 3. Load adjustments from entity storage
  // 4. Compute per-employee aggregates
  // 5. Generate file (xlsx or csv)
  // 6. Store result in Forge storage

  await storage.set(`export_${requestedBy}_${month}`, {
    data: base64EncodedFile,
    format: format,
    filename: `KUP_Payroll_${month}.${format === 'xlsx' ? 'xlsx' : 'csv'}`,
    createdAt: new Date().toISOString()
  });
}
```

**Step 3 — Poll and download (synchronous resolver, fast):**

Frontend polls `getExportStatus` every 2–3 seconds:

```javascript
async function getExportStatus({ month }, context) {
  const result = await storage.get(`export_${context.accountId}_${month}`);
  if (result) {
    // Clean up storage after retrieval
    await storage.delete(`export_${context.accountId}_${month}`);
    return { status: 'ready', data: result.data, format: result.format, filename: result.filename };
  }
  return { status: 'processing' };
}
```

When status is `'ready'`, the frontend receives the base64 file data and triggers the download.

### 5. Manifest additions

Add the async event handler and queue definition:

```yaml
  - key: exportAsyncHandler
    handler: index.exportAsyncHandler

app:
  runtime:
    name: nodejs24.x
  events:
    - key: payroll-export-queue
      handler: exportAsyncHandler
```

Wire `requestPayrollExport` and `getExportStatus` into the existing `managerHandler` resolver.

### 6. Data fetching strategy (optimized for scale)

To minimize API calls, use the JQL search `properties` parameter to fetch entity properties inline:

```
POST /rest/api/3/search
{
  "jql": "issue.property[kup-data].kupMonth = '2026-03-KUP'",
  "fields": ["assignee", "summary", "customfield_10050", "customfield_10120"],
  "properties": ["kup-data", "kup-approval"],
  "maxResults": 100,
  "startAt": 0
}
```

This returns issue fields AND entity properties in a single paginated call. For 500 issues, that's 5 API calls instead of 500+. Paginate with `startAt` until all results are fetched.

Load adjustments for the month via `getAdjustmentsForMonth` (one entity storage query from Phase 8).

### 7. Per-employee computation

Group issues by assignee and compute:

- `workingHours = maxWorkingHours - absenceHours + overtimeHours`
- `creativeHours = sum of kupHours across all issues`
- `cappedCreativeHours = min(creativeHours, workingHours × maxKupPercent / 100)` — only if Phase 12 limit is enabled
- `kupPercent = creativeHours / workingHours × 100`
- `approvalStatus` — "Approved" if all issues approved, "Pending" if all pending, "Mixed" if combination
- `approverName` — from the most recent approval action
- Only include employees who have KUP hours > 0

For mapped custom fields (Employee ID, Cost Center): read the value from the employee's most recent KUP issue. If different issues have different values, take the most recent.

### 8. Output columns

| Column | Source | Always present |
|--------|--------|----------------|
| Employee First Name | Jira user profile | Yes |
| Employee Last Name | Jira user profile | Yes |
| Employee ID | Mapped issue custom field | Only if mapped in config |
| Cost Center | Mapped issue custom field | Only if mapped in config |
| Manager / Approver | Approval data | Yes |
| Working Hours | maxWorkingHours - absence + overtime | Yes |
| Creative Hours | Sum of kupHours | Yes |
| Capped Creative Hours | min(creative, limit) | Only if Phase 12 limit is enabled |
| KUP % | creativeHours / workingHours × 100 | Yes |
| Approval Status | Approved / Pending / Mixed | Yes |

### 9. File generation

**Excel (.xlsx):**
- Use a library compatible with Forge (e.g. `ExcelJS` or `SheetJS`). Check Forge runtime compatibility.
- Single sheet named "KUP Payroll Summary - {month}".
- Header row with column names, bold.
- Data rows, one per employee.
- Auto-column-width for readability.

**CSV:**
- Standard comma-separated values with header row.
- UTF-8 encoding with BOM (for Polish characters in Excel).
- Quoted fields where values may contain commas.

### 10. Manager/Admin UI: export flow

**In `ManagerApprovalView` (kup-global-ui/index.jsx):**

Add an "Export" button in the top controls bar, next to the month selector:

- `Button` with icon, label: "Export Payroll Summary"
- On click, show a small inline section or modal:
  - Format: Excel / CSV (`Select` or radio buttons)
  - "Generate Export" button
- On click "Generate Export":
  1. Call `requestPayrollExport({ month, format })`.
  2. Show `SectionMessage` (appearance: "information"): "Generating export..." with a `Spinner`.
  3. Start polling `getExportStatus({ month })` every 3 seconds.
  4. When status is `'ready'`:
     - Hide the spinner.
     - Decode base64 data and trigger browser download.
     - Show `SectionMessage` (appearance: "confirmation"): "Export ready — download started."
  5. If polling exceeds 60 seconds without result, show error: "Export timed out. Please try again."

**In `MyReportView`** (for non-managers): No export button.

### 11. Cleanup and error handling

- **Storage cleanup:** Delete the export file from storage immediately after the frontend retrieves it (in `getExportStatus`). If the frontend never retrieves it, implement a TTL pattern — the async handler sets a `expiresAt` timestamp, and stale exports are ignored/deleted on next access.
- **Error handling in async handler:** If the export fails (e.g. API errors), store an error status instead of a file:
  ```javascript
  await storage.set(`export_${requestedBy}_${month}`, {
    status: 'error',
    error: 'Failed to fetch issue data. Please try again.',
    createdAt: new Date().toISOString()
  });
  ```
  The frontend detects `status: 'error'` and shows the error message.
- **Concurrent exports:** If a manager requests a new export for the same month while one is processing, the new result overwrites the old one in storage. No conflict.

## Testing

- [ ] Admin maps Employee ID to a custom field — mapping saved correctly
- [ ] Admin maps Cost Center to a custom field — mapping saved correctly
- [ ] Admin leaves both unmapped — export works without those columns
- [ ] Click "Export" — spinner shows, export generates in background
- [ ] Export completes — download triggers automatically
- [ ] Export as Excel — file opens in Excel correctly with Polish characters
- [ ] Export as CSV — file opens correctly with Polish characters (UTF-8 BOM)
- [ ] Report contains one row per employee — no duplicates
- [ ] Employees with zero KUP hours are excluded from the report
- [ ] Working hours column reflects adjusted base (with absence/overtime from Phases 7–11)
- [ ] Creative hours column shows raw total
- [ ] Capped creative hours column present only when Phase 12 limit is enabled
- [ ] Capped creative hours column absent when no limit configured
- [ ] KUP % is calculated correctly
- [ ] Approval status shows correct aggregate (Approved/Pending/Mixed)
- [ ] Approver name shows correctly
- [ ] Employee ID and Cost Center populated from mapped custom fields when configured
- [ ] Employee ID and Cost Center columns omitted when not mapped
- [ ] Non-manager/non-admin cannot trigger the export
- [ ] Export with 500+ employees completes within async timeout (55s)
- [ ] Async handler error — frontend shows error message instead of hanging
- [ ] Polling timeout (60s) — frontend shows timeout message
- [ ] Concurrent export requests — latest result is returned
- [ ] Storage is cleaned up after download
- [ ] Empty month (no KUP data) — appropriate message shown

## Dependencies

Phases 7–11 (absence/overtime adjustments for working hours calculation). Phase 12 (KUP percentage limit for capped creative hours column). Existing manager view and admin config from Phases 1–6.
