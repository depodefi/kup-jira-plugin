import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';
import kvs, { WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { DEFAULT_WORKING_HOURS } from './kup-defaults.js';
import { resolveUserNames } from './user-names.js';

const exportQueue = new Queue({ key: 'payroll-export-queue' });

const adjustmentEntity = kvs.entity('user-monthly-adjustment');

const MONTH_REGEX = /^\d{4}-\d{2}-KUP$/;
const VALID_STATUS_FILTERS = ['all', 'pending', 'approved'];
const ACCOUNT_ID_REGEX = /^[a-zA-Z0-9:-]{1,128}$/;
const MAX_TEAM_MEMBERS = 100;

const managerResolver = new Resolver();

/**
 * Helper: Check whether the given accountId holds the KUP Manager role
 * (either listed as an explicit manager user or is a member of a manager group).
 */
async function checkIsManager(accountId) {
  const config = await storage.get('kup_config');
  const managerUsers = config?.managerUsers || [];
  const managerGroups = config?.managerGroups || [];

  if (managerUsers.includes(accountId)) return true;
  if (managerGroups.length === 0) return false;

  const res = await api.asApp().requestJira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  if (!res.ok) throw new Error(`Manager role check failed: unable to verify group membership (${res.status})`);

  const userGroups = await res.json();
  const userGroupIds = userGroups.map(g => g.groupId);
  return managerGroups.some(gid => userGroupIds.includes(gid));
}

/**
 * getManagerReport: Returns KUP data for all users matching the given month,
 * grouped by assignee, with optional group/team filtering.
 */
managerResolver.define('getManagerReport', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { month, statusFilter = 'all', groupId, teamFilter } = payload;

  if (!month || !MONTH_REGEX.test(month)) return { error: 'Invalid month format' };
  if (!VALID_STATUS_FILTERS.includes(statusFilter)) return { error: 'Invalid status filter' };

  // Build JQL
  let jql = `issue.property[kup-data].kupMonth = "${month}"`;
  if (statusFilter !== 'all') {
    jql += ` AND issue.property[kup-approval].status = "${statusFilter}"`;
  }

  // Paginate through all matching issues using cursor-based pagination
  const allIssues = [];
  let nextPageToken = undefined;
  const maxResults = 100;

  while (true) {
    const requestBody = {
      jql,
      fields: ['summary', 'assignee'],
      properties: ['kup-data', 'kup-approval'],
      maxResults,
    };
    if (nextPageToken) requestBody.nextPageToken = nextPageToken;

    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[getManagerReport] JQL search failed:', res.status, errText);
      break;
    }

    const data = await res.json();
    allIssues.push(...data.issues);

    if (!data.nextPageToken || data.issues.length < maxResults) break;
    nextPageToken = data.nextPageToken;
  }
  // Group issues by assignee accountId
  const userMap = {};
  const unassignedIssues = [];
  for (const issue of allIssues) {
    const assignee = issue.fields?.assignee;
    if (!assignee) {
      const kupData = (issue.properties || {})['kup-data'] || {};
      unassignedIssues.push({
        key: issue.key,
        summary: issue.fields?.summary || '',
        hours: parseFloat(kupData.kupHours) || 0,
      });
      continue;
    }

    const uid = assignee.accountId;
    const props = issue.properties || {};
    const kupData = props['kup-data'] || {};
    const kupApproval = props['kup-approval'] || {};
    const hours = parseFloat(kupData.kupHours) || 0;
    const issueStatus = kupApproval.status || 'pending';

    if (!userMap[uid]) {
      userMap[uid] = {
        accountId: uid,
        displayName: assignee.displayName || uid,
        totalHours: 0,
        issueCount: 0,
        issues: [],
      };
    }

    userMap[uid].totalHours += hours;
    userMap[uid].issueCount += 1;
    userMap[uid].issues.push({
      key: issue.key,
      summary: issue.fields?.summary || '',
      hours,
      status: issueStatus,
    });
  }

  // Filter to Jira group members if groupId provided
  if (groupId) {
    const groupRes = await api.asApp().requestJira(
      route`/rest/api/3/group/member?groupId=${groupId}&maxResults=200`
    );
    if (groupRes.ok) {
      const groupData = await groupRes.json();
      const memberIds = new Set((groupData.values || []).map(m => m.accountId));
      for (const uid of Object.keys(userMap)) {
        if (!memberIds.has(uid)) delete userMap[uid];
      }
    }
  }

  // Filter to manager's custom team if requested
  if (teamFilter) {
    const teamKey = `kup_manager_team_${callerAccountId}`;
    const team = await storage.get(teamKey);
    // Members may be stored as { accountId, displayName } objects or plain strings
    const memberIds = new Set((team?.members || []).map(m =>
      typeof m === 'object' ? m.accountId : m
    ));
    if (memberIds.size > 0) {
      for (const uid of Object.keys(userMap)) {
        if (!memberIds.has(uid)) delete userMap[uid];
      }
    }
  }

  // Compute per-user aggregate status
  const users = Object.values(userMap).map(user => {
    const statuses = new Set(user.issues.map(i => i.status));
    let status;
    if (statuses.size === 1 && statuses.has('approved')) status = 'approved';
    else if (statuses.size === 1 && statuses.has('pending')) status = 'pending';
    else status = 'mixed';
    return { ...user, status };
  });

  const config = await storage.get('kup_config');
  const workingHoursMap = config?.monthWorkingHours || DEFAULT_WORKING_HOURS;
  const maxWorkingHours = workingHoursMap[month] ?? null;

  return { month, maxWorkingHours, users, unassignedIssues, maxKupPercent: config?.maxKupPercent ?? null, kupLimitEnforcement: config?.kupLimitEnforcement ?? 'warn' };
});

/**
 * bulkApprove: Approve all pending KUP issues for a given user + month.
 */
managerResolver.define('bulkApprove', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { accountId, month } = payload;

  if (!month || !MONTH_REGEX.test(month)) return { success: false, error: 'Invalid month format' };
  // accountId is interpolated into JQL below — reject anything that isn't a
  // plain Atlassian account ID to rule out JQL injection.
  if (typeof accountId !== 'string' || !ACCOUNT_ID_REGEX.test(accountId)) {
    return { success: false, error: 'Invalid account ID' };
  }

  // Find all issues for the target user + month
  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary'], properties: ['kup-data', 'kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let approvedCount = 0;
  const approvedKeys = [];
  const now = new Date().toISOString();

  // KUP limit check
  const kupConfig = await storage.get('kup_config');
  const maxKupPercent = kupConfig?.maxKupPercent ?? null;
  const kupLimitEnforcement = kupConfig?.kupLimitEnforcement ?? 'warn';
  if (maxKupPercent) {
    const totalHours = data.issues.reduce((sum, i) => sum + (parseFloat((i.properties?.['kup-data'] || {}).kupHours) || 0), 0);
    const maxWorkingHours = (kupConfig?.monthWorkingHours || DEFAULT_WORKING_HOURS)[month] ?? 0;
    const adjKey = `${accountId}_${month}`;
    const adj = await adjustmentEntity.get(adjKey);
    const adjustedBase = maxWorkingHours - (adj?.absenceHours ?? 0) + (adj?.overtimeHours ?? 0);
    if (adjustedBase > 0) {
      const kupPct = totalHours / adjustedBase * 100;
      if (kupPct > maxKupPercent) {
        if (kupLimitEnforcement === 'block') {
          return { success: false, error: `Cannot approve — KUP is ${kupPct.toFixed(1)}%, which exceeds the company limit of ${maxKupPercent}%.` };
        }
        // warn mode: continue but flag it
        var limitWarning = `Approved despite exceeding limit (${kupPct.toFixed(1)}% vs ${maxKupPercent}% cap).`;
      }
    }
  }

  for (const issue of data.issues) {
    const props = issue.properties || {};
    const currentApproval = props['kup-approval'] || {};

    if (currentApproval.status === 'approved') continue;

    await api.asApp().requestJira(
      route`/rest/api/3/issue/${issue.key}/properties/kup-approval`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'approved',
          approvedBy: callerAccountId,
          approvedAt: now,
        }),
      }
    );

    // Append per-issue audit log entry
    let auditLog = [];
    try {
      const logRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issue.key}/properties/kup-audit-log`
      );
      if (logRes.ok) {
        const body = await logRes.json();
        auditLog = body.value || [];
      }
    } catch (e) {
      // No existing log, start fresh
    }

    auditLog.push({
      userId: callerAccountId,
      timestamp: now,
      action: 'approval',
      changes: { status: { from: 'pending', to: 'approved' } },
    });
    if (auditLog.length > 50) auditLog = auditLog.slice(-50);

    await api.asApp().requestJira(
      route`/rest/api/3/issue/${issue.key}/properties/kup-audit-log`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auditLog),
      }
    );

    approvedKeys.push(issue.key);
    approvedCount++;
  }

  // Append a summary entry to the centralized monthly approval log
  if (approvedCount > 0) {
    const logKey = `kup_approval_log_${month}`;
    let centralLog = await storage.get(logKey) || [];
    centralLog.push({
      action: 'approval',
      managerId: callerAccountId,
      targetUserId: accountId,
      month,
      issueCount: approvedCount,
      issueKeys: approvedKeys,
      timestamp: now,
    });
    if (centralLog.length > 500) centralLog = centralLog.slice(-500);
    await storage.set(logKey, centralLog);
  }

  return { success: true, approvedCount, ...(limitWarning ? { warning: limitWarning } : {}) };
});

/**
 * bulkUnapprove: Reset approval to pending for all approved KUP issues for a given user + month.
 */
managerResolver.define('bulkUnapprove', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { accountId, month } = payload;

  if (!month || !MONTH_REGEX.test(month)) return { success: false, error: 'Invalid month format' };
  // accountId is interpolated into JQL below — reject anything that isn't a
  // plain Atlassian account ID to rule out JQL injection.
  if (typeof accountId !== 'string' || !ACCOUNT_ID_REGEX.test(accountId)) {
    return { success: false, error: 'Invalid account ID' };
  }

  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary'], properties: ['kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let unapprovedCount = 0;
  const unapprovedKeys = [];
  const now = new Date().toISOString();

  for (const issue of data.issues) {
    const props = issue.properties || {};
    const currentApproval = props['kup-approval'] || {};

    if (currentApproval.status !== 'approved') continue;

    await api.asApp().requestJira(
      route`/rest/api/3/issue/${issue.key}/properties/kup-approval`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pending',
          approvedBy: null,
          approvedAt: null,
        }),
      }
    );

    // Append audit log entry
    let auditLog = [];
    try {
      const logRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issue.key}/properties/kup-audit-log`
      );
      if (logRes.ok) {
        const body = await logRes.json();
        auditLog = body.value || [];
      }
    } catch (e) {
      // No existing log, start fresh
    }

    auditLog.push({
      userId: callerAccountId,
      timestamp: now,
      action: 'unapproval',
      changes: { status: { from: 'approved', to: 'pending' } },
    });
    if (auditLog.length > 50) auditLog = auditLog.slice(-50);

    await api.asApp().requestJira(
      route`/rest/api/3/issue/${issue.key}/properties/kup-audit-log`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auditLog),
      }
    );

    unapprovedKeys.push(issue.key);
    unapprovedCount++;
  }

  // Append a summary entry to the centralized monthly approval log
  if (unapprovedCount > 0) {
    const logKey = `kup_approval_log_${month}`;
    let centralLog = await storage.get(logKey) || [];
    centralLog.push({
      action: 'unapproval',
      managerId: callerAccountId,
      targetUserId: accountId,
      month,
      issueCount: unapprovedCount,
      issueKeys: unapprovedKeys,
      timestamp: now,
    });
    if (centralLog.length > 500) centralLog = centralLog.slice(-500);
    await storage.set(logKey, centralLog);
  }

  return { success: true, unapprovedCount };
});

/**
 * getMyKupReport: Returns KUP issues and hours for the current user + month.
 * Used by the "My Report" tab of the global page.
 */
managerResolver.define('getMyKupReport', async ({ payload, context }) => {
  const { month } = payload;
  if (!month) return { issues: [], totalHours: 0, maxWorkingHours: null };
  if (!MONTH_REGEX.test(month)) return { issues: [], totalHours: 0, maxWorkingHours: null };

  const accountId = context.accountId;
  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;

  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields: ['summary', 'issuetype'], properties: ['kup-data', 'kup-approval'], maxResults: 100 }),
    });

    if (!res.ok) return { issues: [], totalHours: 0 };

    const data = await res.json();
    let totalHours = 0;
    let hasApprovedIssues = false;
    const issues = data.issues.map(issue => {
      const kupData = (issue.properties || {})['kup-data'] || {};
      const approvalStatus = (issue.properties || {})['kup-approval']?.status || 'pending';
      const hours = parseFloat(kupData.kupHours) || 0;
      totalHours += hours;
      if (approvalStatus === 'approved') hasApprovedIssues = true;
      return { key: issue.key, summary: issue.fields?.summary || '', hours, approvalStatus };
    });

    const config = await storage.get('kup_config');
    const workingHoursMap = config?.monthWorkingHours || DEFAULT_WORKING_HOURS;
    const maxWorkingHours = workingHoursMap[month] ?? null;

    return { issues, totalHours, maxWorkingHours, hasApprovedIssues, maxKupPercent: config?.maxKupPercent ?? null, kupLimitEnforcement: config?.kupLimitEnforcement ?? 'warn' };
  } catch (err) {
    console.warn('getMyKupReport error', err);
    return { issues: [], totalHours: 0 };
  }
});

/**
 * getCurrentUserRole: Exposes manager role check to the manager UI.
 * Mirrors the same resolver in admin-resolvers.js.
 */
managerResolver.define('getCurrentUserRole', async ({ context }) => {
  const accountId = context.accountId;
  const config = await storage.get('kup_config');
  const managerUsers = config?.managerUsers || [];
  const managerGroups = config?.managerGroups || [];

  if (managerUsers.includes(accountId)) return { isManager: true };
  if (managerGroups.length === 0) return { isManager: false };

  const res = await api.asApp().requestJira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  if (!res.ok) return { isManager: false };

  const userGroups = await res.json();
  const userGroupIds = userGroups.map(g => g.groupId);
  return { isManager: managerGroups.some(gid => userGroupIds.includes(gid)) };
});

/**
 * getAvailableMonths: Returns the configured list of KUP months for the month picker.
 */
managerResolver.define('getAvailableMonths', async () => {
  const config = await storage.get('kup_config');
  let availableMonths = config?.availableMonths;
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = [];
    for (let m = 1; m <= 12; m++) {
      availableMonths.push(`2026-${String(m).padStart(2, '0')}-KUP`);
    }
  }
  return availableMonths;
});

/**
 * getJiraGroups: Returns all Jira groups for the group filter dropdown.
 * Manager-only — group names would otherwise leak to users without
 * the "Browse users and groups" permission.
 */
managerResolver.define('getJiraGroups', async ({ context }) => {
  const isManager = await checkIsManager(context.accountId);
  if (!isManager) return { error: 'Unauthorized' };

  const res = await api.asApp().requestJira(route`/rest/api/3/groups/picker?query=&maxResults=50`);
  const data = await res.json();
  return (data.groups || []).map(g => ({ groupId: g.groupId, name: g.name }));
});

/**
 * getManagerTeam: Returns the current manager's custom team from storage.
 * Members are stored as an array of accountId strings.
 */
managerResolver.define('getManagerTeam', async ({ context }) => {
  const accountId = context.accountId;
  const team = await storage.get(`kup_manager_team_${accountId}`);
  return { members: team?.members || [] };
});

/**
 * saveManagerTeam: Saves the manager's custom team.
 * Accepts members as { accountId, displayName } objects or plain accountId
 * strings; everything else is rejected and unknown keys are stripped.
 */
managerResolver.define('saveManagerTeam', async ({ payload, context }) => {
  const accountId = context.accountId;
  const members = payload?.members;

  if (!Array.isArray(members) || members.length > MAX_TEAM_MEMBERS) {
    return { success: false, error: `Members must be an array of at most ${MAX_TEAM_MEMBERS} entries.` };
  }

  const sanitized = [];
  for (const m of members) {
    const memberId = typeof m === 'string' ? m : m?.accountId;
    const displayName = (typeof m === 'object' && typeof m?.displayName === 'string') ? m.displayName : memberId;
    if (typeof memberId !== 'string' || !ACCOUNT_ID_REGEX.test(memberId)) {
      return { success: false, error: 'Invalid member account ID.' };
    }
    if (typeof displayName !== 'string' || displayName.length > 255) {
      return { success: false, error: 'Invalid member display name.' };
    }
    sanitized.push({ accountId: memberId, displayName });
  }

  await storage.set(`kup_manager_team_${accountId}`, { members: sanitized });
  return { success: true };
});

/**
 * getMyAdjustment: Returns absence/overtime adjustment for the current user + month.
 */
managerResolver.define('getMyAdjustment', async ({ payload, context }) => {
  const { month } = payload;
  if (!month) return { absenceHours: 0, overtimeHours: 0, updatedAt: null };

  const key = `${context.accountId}_${month}`;
  const record = await adjustmentEntity.get(key);
  return {
    absenceHours: record?.absenceHours ?? 0,
    overtimeHours: record?.overtimeHours ?? 0,
    updatedAt: record?.updatedAt ?? null,
  };
});

/**
 * saveMyAdjustment: Saves absence/overtime for the current user + month.
 * Deletes the record if both values are 0 (store-only-when-non-zero rule).
 */
managerResolver.define('saveMyAdjustment', async ({ payload, context }) => {
  const { month, absenceHours, overtimeHours } = payload;
  const accountId = context.accountId;

  if (!month || !MONTH_REGEX.test(month)) return { success: false, error: 'Invalid month format' };
  if (typeof absenceHours !== 'number' || absenceHours < 0 || absenceHours > 744) {
    return { success: false, error: 'Absence hours must be a number between 0 and 744.' };
  }
  if (typeof overtimeHours !== 'number' || overtimeHours < 0 || overtimeHours > 744) {
    return { success: false, error: 'Overtime hours must be a number between 0 and 744.' };
  }

  // Check if any issue for this user/month is approved — lock adjustments if so
  const lockCheckRes = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`,
      fields: [],
      properties: ['kup-approval'],
      maxResults: 100,
    }),
  });
  if (lockCheckRes.ok) {
    const lockData = await lockCheckRes.json();
    const anyApproved = lockData.issues.some(
      i => (i.properties?.['kup-approval']?.status) === 'approved'
    );
    if (anyApproved) {
      return { success: false, locked: true, error: 'Cannot modify adjustments — your hours for this month have been approved. Contact your manager to unapprove first.' };
    }
  }

  const config = await storage.get('kup_config');
  const workingHoursMap = config?.monthWorkingHours || DEFAULT_WORKING_HOURS;
  const maxWorkingHours = workingHoursMap[month];
  if (maxWorkingHours != null && absenceHours > maxWorkingHours) {
    return { success: false, error: `Absence hours cannot exceed max working hours (${maxWorkingHours}).` };
  }

  const key = `${accountId}_${month}`;

  if (absenceHours === 0 && overtimeHours === 0) {
    await adjustmentEntity.delete(key);
    return { success: true, deleted: true };
  }

  await adjustmentEntity.set(key, {
    accountId,
    month,
    absenceHours,
    overtimeHours,
    updatedAt: new Date().toISOString(),
    updatedBy: accountId,
  });
  return { success: true };
});

/**
 * getAdjustmentsForMonth: Returns all adjustments for a given month (manager-only).
 * Returns a map keyed by accountId.
 */
managerResolver.define('getAdjustmentsForMonth', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { month } = payload;
  if (!month || !MONTH_REGEX.test(month)) return { adjustments: {} };

  const adjustments = {};
  let cursor;

  do {
    let q = adjustmentEntity.query().index('by-month').where(WhereConditions.equalTo(month)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const result = await q.getMany();
    for (const item of result.results) {
      adjustments[item.value.accountId] = {
        absenceHours: item.value.absenceHours,
        overtimeHours: item.value.overtimeHours,
      };
    }
    cursor = result.nextCursor;
  } while (cursor);

  return { adjustments };
});

/**
 * getApprovalAuditLog: Returns the centralized approval/unapproval log for a given month.
 * Only accessible to managers.
 */
managerResolver.define('getApprovalAuditLog', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { month } = payload;
  if (!month || !MONTH_REGEX.test(month)) return { entries: [] };

  const logKey = `kup_approval_log_${month}`;
  const log = await storage.get(logKey) || [];

  // Resolve manager/employee display names live — only account IDs are
  // persisted (#19). Falls back to any legacy persisted name, then "Former user".
  const names = await resolveUserNames(log.flatMap(e => [e.managerId, e.targetUserId]));
  const entries = [...log].reverse().map(e => ({
    ...e,
    managerName: names.get(e.managerId) || e.managerName || 'Former user',
    targetUserName: names.get(e.targetUserId) || e.targetUserName || 'Former user',
  }));

  return { entries };
});

/**
 * requestPayrollExport: Queues a background export job and returns immediately.
 * Manager or admin only. The frontend polls getExportStatus until the file is ready.
 */
managerResolver.define('requestPayrollExport', async ({ payload, context }) => {
  const callerAccountId = context.accountId;
  const isManager = await checkIsManager(callerAccountId);
  if (!isManager) return { error: 'Unauthorized' };

  const { month, format } = payload;
  if (!month || !MONTH_REGEX.test(month)) return { error: 'Invalid month format' };
  if (!['xlsx', 'csv'].includes(format)) return { error: 'Invalid format — must be xlsx or csv' };

  const { jobId } = await exportQueue.push({ body: { month, format, requestedBy: callerAccountId } });
  return { jobId, status: 'processing' };
});

/**
 * getExportStatus: Polls for a completed export file.
 * Returns { status: 'processing' } while the background job runs,
 * { status: 'ready', data, format, filename } when done (and deletes the stored result),
 * or { status: 'error', message } if the job failed.
 */
managerResolver.define('getExportStatus', async ({ payload, context }) => {
  const { month } = payload;
  const key = `export_${context.accountId}_${month}`;
  const result = await storage.get(key);

  if (!result) return { status: 'processing' };

  await storage.delete(key);

  if (result.status === 'error') {
    return { status: 'error', message: result.message };
  }

  return { status: 'ready', data: result.data, format: result.format, filename: result.filename };
});

export const managerHandler = managerResolver.getDefinitions();
