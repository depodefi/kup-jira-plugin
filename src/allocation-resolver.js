import api, { route } from '@forge/api';
import kvs from '@forge/kvs';
import { PERIOD_PATTERN } from './kup-period.js';
import { hourUnits } from './kup-allocation.js';
import { trackPersonalData } from './privacy-data.js';

// Missing properties are normal. Permission errors and outages must never be
// mistaken for an empty record, because doing so could overwrite existing data.
async function readProperty(key, name) {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${key}/properties/${name}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to verify the current KUP record.');
  return (await response.json()).value;
}

async function writeProperty(key, name, value) {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${key}/properties/${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error('Jira could not save the KUP record.');
}

// Save one selected issue per invocation. The UI runs these sequentially and
// reports each outcome; a large selection cannot exceed one resolver's timeout.
export async function saveAllocatedHours({ payload, context }) {
  const { key, month, hours } = payload || {};
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key || '') || !PERIOD_PATTERN.test(month || '') || !hourUnits(hours)) {
    return { saved: false, error: 'Invalid issue, month or hours (use up to two decimal places).' };
  }
  let saved = false;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=assignee,project,issuetype,resolutiondate`);
    if (!response.ok) throw new Error('Unable to read this issue.');
    const { fields } = await response.json();
    if (!context.accountId || fields.assignee?.accountId !== context.accountId) throw new Error('This issue is no longer assigned to you.');
    if (!fields.resolutiondate || fields.resolutiondate.slice(0, 7) !== month) throw new Error('This issue was not resolved in the selected month.');
    const config = await kvs.get('kup_config');
    if (config?.enableAll === false) {
      const project = fields.project?.id;
      const types = config.projectSpecificIssueTypes?.[project] || [];
      if (!config.enabledProjects?.includes(project) || (types.length && !types.includes(fields.issuetype?.id))) {
        throw new Error('This issue is outside the configured KUP scope.');
      }
    }
    const [data, approval, audit] = await Promise.all([
      readProperty(key, 'kup-data'), readProperty(key, 'kup-approval'), readProperty(key, 'kup-audit-log'),
    ]);
    if (data != null) throw new Error('This issue already has a KUP entry. Refresh the list.');
    if (approval?.status === 'approved') throw new Error('This issue has already been approved.');
    if (audit != null && !Array.isArray(audit)) throw new Error('Unable to read the activity history.');
    // Register the account before writing personal data. All Jira operations
    // run asUser, including PUT, so Jira enforces the caller's edit permissions.
    await trackPersonalData([context.accountId]);
    await writeProperty(key, 'kup-data', { kupMonth: month, kupHours: Number(hours), employeeAccountId: context.accountId });
    saved = true;
    if (!approval) await writeProperty(key, 'kup-approval', { status: 'pending', approvedBy: null, approvedAt: null });
    await writeProperty(key, 'kup-audit-log', [...(audit || []), {
      userId: context.accountId, timestamp: new Date().toISOString(),
      changes: {
        kupMonth: { from: null, to: month }, kupHours: { from: null, to: Number(hours) },
        employeeAccountId: { from: null, to: context.accountId },
      },
    }].slice(-50));
    return { saved: true };
  } catch (error) {
    // Issue properties are separate writes, not a transaction. Do not invite a
    // retry of hours that were saved if a later approval/audit write failed.
    return { saved, error: saved ? 'Hours saved, but approval or activity history could not be updated. Review this issue.' : error.message };
  }
}
