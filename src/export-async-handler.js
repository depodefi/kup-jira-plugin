import api, { route } from '@forge/api';
import kvs, { WhereConditions } from '@forge/kvs';
import * as XLSX from 'xlsx';
import { DEFAULT_WORKING_HOURS } from './kup-defaults.js';
import { resolveUserNames } from './user-names.js';

const adjustmentEntity = kvs.entity('user-monthly-adjustment');

function buildHeaders(enableKupLimit, exportFieldMappings) {
  const h = ['First Name', 'Last Name'];
  if (exportFieldMappings.employeeId) h.push('Employee ID');
  if (exportFieldMappings.costCenter) h.push('Cost Center');
  h.push('Manager / Approver', 'Working Hours', 'Creative Hours');
  if (enableKupLimit) h.push('Capped Creative Hours');
  h.push('KUP %', 'Approval Status');
  return h;
}

function rowToArray(row, enableKupLimit, exportFieldMappings) {
  const cells = [row.firstName, row.lastName];
  if (exportFieldMappings.employeeId) cells.push(row.employeeId ?? '');
  if (exportFieldMappings.costCenter) cells.push(row.costCenter ?? '');
  cells.push(row.approver, row.workingHours, row.creativeHours);
  if (enableKupLimit) cells.push(row.cappedCreativeHours ?? '');
  cells.push(row.kupPct, row.approvalStatus);
  return cells;
}

function generateXlsx(rows, month, enableKupLimit, exportFieldMappings) {
  const headers = buildHeaders(enableKupLimit, exportFieldMappings);
  const sheetData = [headers, ...rows.map(r => rowToArray(r, enableKupLimit, exportFieldMappings))];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Bold header row
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = { font: { bold: true } };
  }

  // Auto column widths
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));

  const wb = XLSX.utils.book_new();
  // Sheet names are limited to 31 characters
  XLSX.utils.book_append_sheet(wb, ws, `KUP Payroll - ${month}`.slice(0, 31));

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

function generateCsv(rows, enableKupLimit, exportFieldMappings) {
  const headers = buildHeaders(enableKupLimit, exportFieldMappings);
  const allRows = [headers, ...rows.map(r => rowToArray(r, enableKupLimit, exportFieldMappings))];

  const csvText = allRows.map(row =>
    row.map(cell => {
      const str = String(cell ?? '');
      return (str.includes(',') || str.includes('"') || str.includes('\n'))
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  ).join('\r\n');

  // UTF-8 BOM ensures Polish characters display correctly in Excel
  return Buffer.from('\uFEFF' + csvText, 'utf-8').toString('base64');
}

/**
 * Async event handler for payroll export.
 * Invoked by the payroll-export-queue event, runs up to 55 seconds in the background.
 * Fetches all KUP issues for the requested month, computes per-employee payroll data,
 * generates the requested file, and stores it in Forge storage for the frontend to poll.
 */
export async function exportAsyncHandler(event) {
  const { month, format, requestedBy } = event.body;
  const storageKey = `export_${requestedBy}_${month}`;

  try {
    // 1. Load config
    const config = await kvs.get('kup_config') ?? {};
    const workingHoursMap = config.monthWorkingHours || DEFAULT_WORKING_HOURS;
    const baseWorkingHours = workingHoursMap[month] ?? 160;
    const exportFieldMappings = config.exportFieldMappings || {};
    const enableKupLimit = config.maxKupPercent != null;
    const maxKupPercent = config.maxKupPercent ?? 100;

    // 2. Build Jira fields list — only custom fields that are mapped
    const extraFields = [];
    if (exportFieldMappings.employeeId) extraFields.push(exportFieldMappings.employeeId);
    if (exportFieldMappings.costCenter) extraFields.push(exportFieldMappings.costCenter);
    const fieldsToFetch = ['assignee', ...extraFields];

    // 3. Paginate through all issues matching this month via cursor-based JQL
    const allIssues = [];
    let nextPageToken;
    do {
      const body = {
        jql: `issue.property[kup-data].kupMonth = "${month}"`,
        fields: fieldsToFetch,
        properties: ['kup-data', 'kup-approval'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      };
      const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Jira search failed with status ${res.status}`);
      const data = await res.json();
      allIssues.push(...(data.issues || []));
      nextPageToken = data.issues?.length === 100 ? data.nextPageToken : undefined;
    } while (nextPageToken);

    // 4. Load all absence/overtime adjustments for the month
    const adjustmentsMap = {};
    let cursor;
    do {
      let q = adjustmentEntity.query().index('by-month').where(WhereConditions.equalTo(month)).limit(100);
      if (cursor) q = q.cursor(cursor);
      const result = await q.getMany();
      for (const item of result.results) {
        adjustmentsMap[item.value.accountId] = {
          absenceHours: item.value.absenceHours || 0,
          overtimeHours: item.value.overtimeHours || 0,
        };
      }
      cursor = result.nextCursor;
    } while (cursor);

    // 5. Group by assignee, sum KUP hours, collect approval statuses
    const employeeMap = {};
    for (const issue of allIssues) {
      const assignee = issue.fields?.assignee;
      if (!assignee) continue;

      const { accountId } = assignee;
      const kupData = (issue.properties || {})['kup-data'] || {};
      const kupApproval = (issue.properties || {})['kup-approval'] || {};
      const hours = parseFloat(kupData.kupHours) || 0;
      if (hours === 0) continue;

      if (!employeeMap[accountId]) {
        const parts = (assignee.displayName || '').split(' ');
        employeeMap[accountId] = {
          accountId,
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          employeeId: exportFieldMappings.employeeId
            ? (issue.fields[exportFieldMappings.employeeId] ?? '')
            : undefined,
          costCenter: exportFieldMappings.costCenter
            ? (issue.fields[exportFieldMappings.costCenter] ?? '')
            : undefined,
          creativeHours: 0,
          approvalStatuses: [],
          approverId: null,
        };
      }

      employeeMap[accountId].creativeHours += hours;
      employeeMap[accountId].approvalStatuses.push(kupApproval.status || 'pending');
      if (kupApproval.approvedBy) {
        employeeMap[accountId].approverId = kupApproval.approvedBy;
      }
    }

    // Resolve approver account IDs to display names live — names are never
    // persisted on the approval property (#19).
    const approverNames = await resolveUserNames(
      Object.values(employeeMap).map(e => e.approverId)
    );

    // 6. Compute final per-employee output rows
    const outputRows = Object.values(employeeMap).map(emp => {
      const adj = adjustmentsMap[emp.accountId] || { absenceHours: 0, overtimeHours: 0 };
      const workingHours = parseFloat(
        (baseWorkingHours - adj.absenceHours + adj.overtimeHours).toFixed(2)
      );
      const cappedCreativeHours = enableKupLimit && workingHours > 0
        ? parseFloat(Math.min(emp.creativeHours, workingHours * maxKupPercent / 100).toFixed(2))
        : null;
      const kupPct = workingHours > 0
        ? parseFloat((emp.creativeHours / workingHours * 100).toFixed(2))
        : 0;

      const statuses = new Set(emp.approvalStatuses);
      const approvalStatus = statuses.size === 1
        ? (statuses.has('approved') ? 'Approved' : 'Pending')
        : 'Mixed';

      return {
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeId: emp.employeeId,
        costCenter: emp.costCenter,
        approver: emp.approverId ? (approverNames.get(emp.approverId) || 'Former user') : '',
        workingHours,
        creativeHours: emp.creativeHours,
        cappedCreativeHours,
        kupPct,
        approvalStatus,
      };
    });

    // 7. Generate the file and encode as base64
    const filename = format === 'xlsx'
      ? `KUP_Payroll_${month}.xlsx`
      : `KUP_Payroll_${month}.csv`;

    const fileBase64 = format === 'xlsx'
      ? generateXlsx(outputRows, month, enableKupLimit, exportFieldMappings)
      : generateCsv(outputRows, enableKupLimit, exportFieldMappings);

    // 8. Store result — frontend will poll for it; 1-hour TTL cleans up unclaimed exports
    await kvs.set(storageKey, {
      data: fileBase64,
      format,
      filename,
      createdAt: new Date().toISOString(),
    }, { ttl: { value: 1, unit: 'HOURS' } });

  } catch (err) {
    console.error('[exportAsyncHandler] Export failed:', err);
    // Store error so the frontend can surface it instead of timing out
    await kvs.set(storageKey, {
      status: 'error',
      message: err.message || 'Export failed unexpectedly',
      createdAt: new Date().toISOString(),
    }, { ttl: { value: 1, unit: 'HOURS' } });
  }
}
