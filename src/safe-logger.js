import { randomUUID } from 'node:crypto';

// Only these operational fields are allowed into Forge logs. Keeping an
// explicit allow-list prevents a future caller from accidentally logging an
// account ID, issue key, Jira response body, or another personal field.
const SAFE_FIELDS = new Set([
  'requestId', 'month', 'durationMs', 'pagesFetched', 'issuesProcessed',
  'employeesProcessed', 'status', 'httpStatus', 'format', 'groupPages',
  'membersProcessed', 'approvedCount', 'unapprovedCount', 'issueCount',
  'exportRows', 'errorCode', 'phase', 'pollCount', 'queueStatus',
]);

export function createRequestId() {
  return randomUUID();
}

export function safeErrorCode(error) {
  if (!error) return 'unknown';
  if (typeof error.code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(error.code)) return error.code;
  if (typeof error.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.name)) return error.name;
  return 'Error';
}

export function logSafe(level, operation, details = {}) {
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safeDetails[key] = value;
    }
  }

  const entry = { operation, ...safeDetails };
  const writer = typeof console[level] === 'function' ? console[level] : console.info;
  writer(`[KUP] ${JSON.stringify(entry)}`);
}
