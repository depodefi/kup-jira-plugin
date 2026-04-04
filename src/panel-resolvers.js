import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

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
    availableMonths = [];
    for (let m = 1; m <= 12; m++) {
      availableMonths.push(`2026-${String(m).padStart(2, '0')}-KUP`);
    }
  }

  const kupData = kupDataRes?.ok ? (await kupDataRes.json()).value || null : null;
  const approval = approvalRes?.ok ? (await approvalRes.json()).value || null : null;

  const APP_UUID = 'a8161fad-fc13-466f-aa28-6f264f00b396';
  const envId = context.environmentId;
  const globalPagePath = envId ? `/jira/apps/${APP_UUID}/${envId}` : null;

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
    const newData = { kupMonth, kupHours: Number(kupHours) || 0 };
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
      return { success: false, error: `Failed to save KUP data: ${errText}` };
    }

    // 4. Build the audit entry using the authenticated user's account ID
    const accountId = context.accountId || 'unknown';
    let userName = 'Unknown User';
    let userEmail = '';

    if (accountId !== 'unknown') {
      try {
        // Fetch using the App credentials (asApp) to bypass requiring individual users
        // to click "Allow access" on Forge consent screens.
        const userRes = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
        if (userRes.ok) {
          const userObj = await userRes.json();
          userName = userObj.displayName || userName;
          userEmail = userObj.emailAddress || '';
        } else {
          console.warn('Jira API rejected user fetch via asApp:', userRes.status, await userRes.text());
        }
      } catch (e) {
        console.warn('Could not fetch user details', e);
      }
    }

    const auditEntry = {
      userId: accountId,
      userName: userName,
      userEmail: userEmail,
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
    return { success: false, error: err.message };
  }
});

export const kupPanelHandler = panelResolver.getDefinitions();
