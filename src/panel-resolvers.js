import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';
import { defaultAvailableMonths } from './kup-defaults.js';

const MONTH_REGEX = /^\d{4}-\d{2}-KUP$/;
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
 * the available months list from the admin config, and the audit log.
 */
panelResolver.define('getPanelData', async ({ context }) => {
  const issueId = context.extension?.issue?.id;
  const projectId = context.extension?.project?.id;
  const issueTypeId = context.extension?.issue?.typeId;

  if (!issueId) return { eligible: false };

  // Fetch config and issue properties all at once — no sequential dependency
  const [config, kupDataRes, approvalRes] = await Promise.all([
    storage.get('kup_config'),
    api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/kup-data`).catch(() => null),
    api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/kup-approval`).catch(() => null),
  ]);

  // Eligibility check uses context values — no extra API call required
  if (!checkEligibility(config, projectId, issueTypeId)) {
    return { eligible: false };
  }

  let availableMonths = config?.availableMonths;
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = defaultAvailableMonths();
  }

  const kupData = kupDataRes?.ok ? (await kupDataRes.json()).value || null : null;
  const approval = approvalRes?.ok ? (await approvalRes.json()).value || null : null;

  const appId = resolveAppId(context);
  const envId = context.environmentId;
  const globalPagePath = appId && envId ? `/jira/apps/${appId}/${envId}` : null;

  return { eligible: true, kupData, availableMonths, approval, globalPagePath };
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
 * The kupMonth format is YYYY-MM-KUP (e.g. "2026-01-KUP").
 */
panelResolver.define('saveKupData', async ({ payload, context }) => {
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

    // 3. Save the new KUP data as an Issue Entity Property
    const newData = { kupMonth, kupHours: parsedHours };
    const saveRes = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-data`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      }
    );
    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error('Failed to save KUP data:', saveRes.status, errText);
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

    return { success: true, kupData: newData, auditLog };
  } catch (err) {
    console.error('Error saving KUP data:', err);
    return { success: false, error: 'An unexpected error occurred while saving. Please try again.' };
  }
});

export const kupPanelHandler = panelResolver.getDefinitions();
