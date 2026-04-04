import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';
import kvs, { WhereConditions } from '@forge/kvs';
import { DEFAULT_WORKING_HOURS } from './kup-defaults.js';

const adjustmentEntity = kvs.entity('user-monthly-adjustment');

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
  if (!res.ok) return false;

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
  console.log('[getManagerReport] called with month:', month, 'statusFilter:', statusFilter, 'callerAccountId:', callerAccountId);

  // Build JQL
  let jql = `issue.property[kup-data].kupMonth = "${month}"`;
  if (statusFilter !== 'all') {
    jql += ` AND issue.property[kup-approval].status = "${statusFilter}"`;
  }
  console.log('[getManagerReport] JQL:', jql);

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
    console.log('[getManagerReport] page got:', data.issues.length, 'nextPageToken:', data.nextPageToken ?? 'none');
    allIssues.push(...data.issues);

    if (!data.nextPageToken || data.issues.length < maxResults) break;
    nextPageToken = data.nextPageToken;
  }
  console.log('[getManagerReport] total issues fetched:', allIssues.length);

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

  console.log('[getManagerReport] returning', users.length, 'users,', unassignedIssues.length, 'unassigned, maxWorkingHours:', maxWorkingHours);
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

  // Fetch manager's display name for audit entries
  let callerName = 'Unknown Manager';
  try {
    const userRes = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${callerAccountId}`);
    if (userRes.ok) {
      const userObj = await userRes.json();
      callerName = userObj.displayName || callerName;
    }
  } catch (e) {
    console.warn('Could not fetch manager display name', e);
  }

  // Find all issues for the target user + month (include assignee for display name)
  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary', 'assignee'], properties: ['kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let approvedCount = 0;
  const approvedKeys = [];
  const now = new Date().toISOString();
  const targetUserName = data.issues[0]?.fields?.assignee?.displayName || accountId;

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
          approvedByName: callerName,
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
      userName: callerName,
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
      managerName: callerName,
      targetUserId: accountId,
      targetUserName,
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

  // Fetch manager's display name for audit entries
  let callerName = 'Unknown Manager';
  try {
    const userRes = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${callerAccountId}`);
    if (userRes.ok) {
      const userObj = await userRes.json();
      callerName = userObj.displayName || callerName;
    }
  } catch (e) {
    console.warn('Could not fetch manager display name', e);
  }

  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary', 'assignee'], properties: ['kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let unapprovedCount = 0;
  const unapprovedKeys = [];
  const now = new Date().toISOString();
  const targetUserName = data.issues[0]?.fields?.assignee?.displayName || accountId;

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
          approvedByName: null,
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
      userName: callerName,
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
      managerName: callerName,
      targetUserId: accountId,
      targetUserName,
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
 */
managerResolver.define('getJiraGroups', async () => {
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
 * Expects payload.members to be an array of accountId strings.
 */
managerResolver.define('saveManagerTeam', async ({ payload, context }) => {
  const accountId = context.accountId;
  const { members } = payload;
  await storage.set(`kup_manager_team_${accountId}`, { members });
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

  if (typeof absenceHours !== 'number' || absenceHours < 0) {
    return { success: false, error: 'Absence hours must be a non-negative number.' };
  }
  if (typeof overtimeHours !== 'number' || overtimeHours < 0) {
    return { success: false, error: 'Overtime hours must be a non-negative number.' };
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
  if (!month) return { adjustments: {} };

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
  if (!month) return { entries: [] };

  const logKey = `kup_approval_log_${month}`;
  const log = await storage.get(logKey) || [];
  // Return in reverse-chronological order
  return { entries: [...log].reverse() };
});

export const managerHandler = managerResolver.getDefinitions();
