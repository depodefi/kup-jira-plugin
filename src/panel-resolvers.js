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
  const availableMonths = (config && config.availableMonths) ? config.availableMonths : [];

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

  return {
    eligible: true,
    kupData,
    availableMonths,
    auditLog,
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
    // 1. Read the current KUP data to calculate the diff for auditing
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

    // 2. Save the new KUP data as an Issue Entity Property
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

    // 3. Build the audit entry using the authenticated user's account ID
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

    // 4. Append to the audit log Entity Property (max 50 entries to stay safe)
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

    // Only add entry if something actually changed
    if (Object.keys(auditEntry.changes).length > 0) {
      auditLog.push(auditEntry);
      // Keep only the last 50 entries to prevent property size limits
      if (auditLog.length > 50) {
        auditLog = auditLog.slice(-50);
      }

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
