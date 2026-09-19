import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvs from '@forge/kvs';
import { createRequestId, logSafe, safeErrorCode } from './safe-logger.js';
import { trackPersonalData } from './privacy-data.js';
import { requireActiveLicense } from './license-guard.js';

import { PERIOD_PATTERN as MONTH_REGEX } from './kup-period.js';
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Derive the app's UUID at runtime so the global-page deep link is correct
 * regardless of which registration is serving the request — development,
 * staging, and Marketplace production each get a distinct app id.
 *
 * `localId` is the module ARI, e.g.
 *   ari:cloud:ecosystem::extension/{appId}/{environmentId}/{module}
 * whose first UUID segment is the app id. Returns null when it can't be
 * determined, in which case the panel simply hides the link.
 */
function resolveAppId(context) {
  const fromAppId = typeof context?.appId === 'string' && context.appId.match(UUID_REGEX);
  if (fromAppId) return fromAppId[0];
  const fromLocalId = typeof context?.localId === 'string' && context.localId.match(UUID_REGEX);
  if (fromLocalId) return fromLocalId[0];
  return null;
}

const panelResolver = new Resolver();

/**
 * Helper: Check eligibility using values already known from the resolver context.
 * project.id and issue.typeId are provided by Forge for jira:issueContext —
 * no Jira API call needed.
 */
function checkEligibility(config, projectId, issueTypeId) {
  if (!config || !projectId) return false;
  if (config.enableAll === true) return true;
  if (!config.enabledProjects?.includes(projectId)) return false;
  const projectIssueTypes = config.projectSpecificIssueTypes?.[projectId] || [];
  if (projectIssueTypes.length === 0) return true;
  return projectIssueTypes.includes(issueTypeId);
}

/**
 * getPanelData: Called when the issue context panel loads.
 * Returns eligibility status, current KUP data saved on the issue,
 * approval status and the report link. Period selection needs no admin list.
 */
panelResolver.define('getPanelData', async ({ context }) => {
  const issueId = context.extension?.issue?.id;
  const projectId = context.extension?.project?.id;
  const issueTypeId = context.extension?.issue?.typeId;

  if (!issueId) return { eligible: false };

  // Fetch config and issue properties all at once — no sequential dependency
  const [config, kupDataRes, approvalRes, issueRes] = await Promise.all([
    kvs.get('kup_config'),
    api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/kup-data`).catch(() => null),
    api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/kup-approval`).catch(() => null),
    // Assignee is read in the viewing user's permission context. This handles
    // issue-security schemes where the user can see an issue but the app user
    // cannot, and avoids falsely treating a visible assignee as missing.
    api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=assignee`).catch(() => null),
  ]);

  // Eligibility check uses context values — no extra API call required
  if (!checkEligibility(config, projectId, issueTypeId)) {
    return { eligible: false };
  }


  const kupData = kupDataRes?.ok ? (await kupDataRes.json()).value || null : null;
  const approval = approvalRes?.ok ? (await approvalRes.json()).value || null : null;
  const issue = issueRes?.ok ? await issueRes.json() : null;
  const currentAssigneeAccountId = issue?.fields?.assignee?.accountId || null;
  if (!issueRes?.ok) {
    logSafe('warn', 'getPanelData.assignee', {
      httpStatus: issueRes?.status,
      status: 'jira_error',
    });
  }

  const appId = resolveAppId(context);
  const envId = context.environmentId;
  const globalPagePath = appId && envId ? `/jira/apps/${appId}/${envId}` : null;

  return { eligible: true, kupData, approval, currentAssigneeAccountId, globalPagePath };
});

/**
 * getAuditLog: Fetched separately after the panel form renders,
 * so the form is visible immediately without waiting for the log.
 */
panelResolver.define('getAuditLog', async ({ context }) => {
  const issueId = context.extension?.issue?.id;
  if (!issueId) return { auditLog: [] };

  try {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-audit-log`
    );
    if (res.ok) {
      const body = await res.json();
      return { auditLog: body.value || [] };
    }
  } catch (err) {
    // No audit log yet
  }
  return { auditLog: [] };
});

/**
 * saveKupData: Saves KUP Month and KUP Hours as an Entity Property
 * on the issue, and appends a timestamped audit entry recording
 * who made the change and what was modified.
 *
 * The kupMonth format is YYYY-MM (e.g. "2026-01").
 */
panelResolver.define('saveKupData', async ({ payload, context }) => {
  const requestId = createRequestId();
  const issueId = context.extension?.issue?.id;
  if (!issueId || !payload) {
    return { success: false, error: 'Missing issue or payload' };
  }

  const { kupMonth, kupHours } = payload;

  if (!kupMonth || !MONTH_REGEX.test(kupMonth)) {
    return { success: false, error: 'Invalid month format' };
  }
  const parsedHours = Number(kupHours);
  if (isNaN(parsedHours) || parsedHours < 0 || parsedHours > 744) {
    return { success: false, error: 'KUP hours must be a number between 0 and 744.' };
  }

  try {
    // 1. Guard: block edits on approved issues
    try {
      const approvalRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueId}/properties/kup-approval`
      );
      if (approvalRes.ok) {
        const body = await approvalRes.json();
        if (body.value?.status === 'approved') {
          return { success: false, error: 'Cannot edit KUP data — this issue has been approved. Contact your manager to unapprove first.' };
        }
      }
    } catch (err) {
      // No approval property — proceed normally
    }

    // 2. Read the current KUP data to calculate the diff for auditing
    let oldData = { kupMonth: null, kupHours: null };
    try {
      const existingRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueId}/properties/kup-data`
      );
      if (existingRes.ok) {
        const body = await existingRes.json();
        oldData = body.value || oldData;
      }
    } catch (err) {
      // No existing data, default oldData is fine
    }

    // 3. The current Jira assignee is the only valid owner. A save performed
    // before approval intentionally refreshes the stored attribution after an
    // issue reassignment; reports never infer it later without an explicit save.
    const issueRes = await api.asUser().requestJira(
      route`/rest/api/3/issue/${issueId}?fields=assignee`
    );
    if (!issueRes.ok) {
      return { success: false, error: 'Unable to determine the current assignee. Please try again.' };
    }
    const issue = await issueRes.json();
    const employeeAccountId = issue.fields?.assignee?.accountId;
    if (!employeeAccountId) {
      return { success: false, error: 'Assign this issue before saving KUP data.' };
    }

    const newData = { kupMonth, kupHours: parsedHours, employeeAccountId };
    const saveRes = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-data`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      }
    );
    if (!saveRes.ok) {
      logSafe('error', 'saveKupData', { requestId, httpStatus: saveRes.status, status: 'jira_error' });
      return { success: false, error: 'Failed to save KUP data. Please try again.' };
    }

    // 4. Build the audit entry. Store only the account ID — display names and
    //    emails are resolved live at render time, never persisted (#19).
    const accountId = context.accountId || 'unknown';

    const auditEntry = {
      userId: accountId,
      timestamp: new Date().toISOString(),
      changes: {},
    };

    // Only record fields that actually changed
    if (oldData.kupMonth !== kupMonth) {
      auditEntry.changes.kupMonth = { from: oldData.kupMonth, to: kupMonth };
    }
    if (oldData.kupHours !== newData.kupHours) {
      auditEntry.changes.kupHours = { from: oldData.kupHours, to: newData.kupHours };
    }
    if (oldData.employeeAccountId !== employeeAccountId) {
      auditEntry.changes.employeeAccountId = {
        from: oldData.employeeAccountId || null,
        to: employeeAccountId,
      };
    }

    // 5. Initialize kup-approval on first save (status is guaranteed pending at this point)
    const approvalInitRes = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-approval`
    );
    if (!approvalInitRes.ok) {
      await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueId}/properties/kup-approval`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending', approvedBy: null, approvedByName: null, approvedAt: null }),
        }
      );
    }

    // 6. Append to the audit log Entity Property (max 50 entries to stay safe)
    let auditLog = [];
    try {
      const logRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueId}/properties/kup-audit-log`
      );
      if (logRes.ok) {
        const body = await logRes.json();
        auditLog = body.value || [];
      }
    } catch (err) {
      // No existing log, start fresh
    }

    if (Object.keys(auditEntry.changes).length > 0) {
      auditLog.push(auditEntry);
    }

    if (auditLog.length > 50) auditLog = auditLog.slice(-50);

    if (auditLog.length > 0) {
      await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueId}/properties/kup-audit-log`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(auditLog),
        }
      );
    }

    // Both the employee attributed with the hours and the person performing
    // the edit are covered by Atlassian's personal-data lifecycle. Register
    // them only after all related writes have succeeded.
    await trackPersonalData([accountId, employeeAccountId, oldData.employeeAccountId].filter(Boolean));

    return { success: true, kupData: newData, auditLog };
  } catch (err) {
    logSafe('error', 'saveKupData', { requestId, errorCode: safeErrorCode(err), status: 'error' });
    return { success: false, error: 'An unexpected error occurred while saving. Please try again.' };
  }
});

export const kupPanelHandler = requireActiveLicense(panelResolver.getDefinitions());
