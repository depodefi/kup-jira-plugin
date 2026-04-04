import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const panelResolver = new Resolver();

/**
 * Helper: Check if the current issue's project and issue type
 * are enabled for KUP tracking in the global admin configuration.
 * Returns true if KUP tracking applies to this issue.
 */
async function isKupEligible(issueId) {
  if (!issueId) return false;

  try {
    // Fetch the issue's project and issue type from Jira
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}?fields=project,issuetype`
    );
    if (!res.ok) return false;

    const issueData = await res.json();
    const projectId = issueData.fields.project.id;
    const issueTypeId = issueData.fields.issuetype.id;

    // Load the global KUP configuration from Forge Storage
    const config = await storage.get('kup_config');
    if (!config) return false;

    // If the master toggle is on, all projects/issue types are eligible
    if (config.enableAll === true) return true;

    // Check if this project is explicitly enabled
    if (!config.enabledProjects || !config.enabledProjects.includes(projectId)) {
      return false;
    }

    // Check project-specific issue types (empty array = all types allowed)
    const projectIssueTypes = config.projectSpecificIssueTypes?.[projectId] || [];
    if (projectIssueTypes.length === 0) return true;

    return projectIssueTypes.includes(issueTypeId);
  } catch (err) {
    console.error('Error checking KUP eligibility:', err);
    return false;
  }
}

/**
 * getPanelData: Called when the issue context panel loads.
 * Returns eligibility status, current KUP data saved on the issue,
 * the available months list from the admin config, and the audit log.
 */
panelResolver.define('getPanelData', async ({ context }) => {
  const issueId = context.extension?.issue?.id;
  const issueKey = context.extension?.issue?.key;

  // Check if KUP tracking is enabled for this issue
  const eligible = await isKupEligible(issueId);
  if (!eligible) {
    return { eligible: false };
  }

  // Load the admin config to get the available months
  const config = await storage.get('kup_config');
  let availableMonths = config?.availableMonths;
  
  // If undefined or empty (first install/never configured), default to 2026
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = [];
    for (let m = 1; m <= 12; m++) {
      availableMonths.push(`2026-${String(m).padStart(2, '0')}-KUP`);
    }
  }

  // Fetch the current KUP data stored as an Entity Property on this issue
  let kupData = null;
  try {
    const dataRes = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-data`
    );
    if (dataRes.ok) {
      const body = await dataRes.json();
      kupData = body.value || null;
    }
  } catch (err) {
    // Property does not exist yet, that's fine
    console.log('No existing kup-data property for issue', issueKey);
  }

  // Fetch the audit log stored as a separate Entity Property
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
    // No audit log yet, that's fine
  }

  // Fetch the approval status
  let approval = null;
  try {
    const approvalRes = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueId}/properties/kup-approval`
    );
    if (approvalRes.ok) {
      const body = await approvalRes.json();
      approval = body.value || null;
    }
  } catch (err) {
    // No approval property yet
  }

  // Build the global page path: /jira/apps/{appId}/{environmentId}
  // The app UUID is static; environmentId is installation-specific and comes from context.
  const APP_UUID = 'a8161fad-fc13-466f-aa28-6f264f00b396';
  const envId = context.environmentId;
  const globalPagePath = envId ? `/jira/apps/${APP_UUID}/${envId}` : null;

  return {
    eligible: true,
    kupData,
    availableMonths,
    auditLog,
    approval,
    globalPagePath,
  };
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
