import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';
import { DEFAULT_WORKING_HOURS } from './kup-defaults.js';

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

  // Build JQL
  let jql = `issue.property[kup-data].kupMonth = "${month}"`;
  if (statusFilter !== 'all') {
    jql += ` AND issue.property[kup-approval].status = "${statusFilter}"`;
  }

  // Paginate through all matching issues
  const allIssues = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        fields: ['summary', 'assignee'],
        properties: ['kup-data', 'kup-approval'],
        startAt,
        maxResults,
      }),
    });

    if (!res.ok) {
      console.warn('Manager JQL search failed:', res.status, await res.text());
      break;
    }

    const data = await res.json();
    allIssues.push(...data.issues);

    if (allIssues.length >= data.total || data.issues.length < maxResults) break;
    startAt += maxResults;
  }

  // Group issues by assignee accountId
  const userMap = {};
  for (const issue of allIssues) {
    const assignee = issue.fields?.assignee;
    if (!assignee) continue;

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
      route`/rest/api/3/group/member?groupname=${groupId}`
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
    const config = await storage.get('kup_config');
    const customTeam = config?.managerTeams?.[callerAccountId] || [];
    if (customTeam.length > 0) {
      const teamSet = new Set(customTeam);
      for (const uid of Object.keys(userMap)) {
        if (!teamSet.has(uid)) delete userMap[uid];
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

  return { month, maxWorkingHours, users };
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

  // Find all issues for the target user + month
  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary'], properties: ['kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let approvedCount = 0;
  const now = new Date().toISOString();

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

    approvedCount++;
  }

  return { success: true, approvedCount };
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
    body: JSON.stringify({ jql, fields: ['summary'], properties: ['kup-approval'], maxResults: 100 }),
  });

  if (!res.ok) return { success: false, error: 'Failed to search issues' };

  const data = await res.json();
  let unapprovedCount = 0;
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

    unapprovedCount++;
  }

  return { success: true, unapprovedCount };
});

export const managerHandler = managerResolver.getDefinitions();
