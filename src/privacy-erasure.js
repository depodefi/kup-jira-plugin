import api, { route } from '@forge/api';
import kvs, { WhereConditions } from '@forge/kvs';
import { removePrivacyAccount } from './privacy-data.js';

const TEAM_KEY_PREFIX = 'kup_manager_team_';
const APPROVAL_LOG_KEY_PREFIX = 'kup_approval_log_';
const EXPORT_KEY_PREFIX = 'export_';

async function listKvsRecords(prefix) {
  const records = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    records.push(...page.results);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

async function eraseAccountFromTeams(accountId) {
  const teams = await listKvsRecords(TEAM_KEY_PREFIX);
  await Promise.all(teams.map(async ({ key, value }) => {
    // A manager's own team is personal data too; removing the team avoids
    // retaining a relationship map after that manager's account is closed.
    if (key === `${TEAM_KEY_PREFIX}${accountId}`) {
      await kvs.delete(key);
      return;
    }
    const retainedMembers = (value?.members || []).filter(member => {
      const memberId = typeof member === 'string' ? member : member?.accountId;
      return memberId !== accountId;
    });
    if (retainedMembers.length !== (value?.members || []).length) {
      await kvs.set(key, { members: retainedMembers });
    }
  }));
}

/**
 * The app does not intentionally retain profile fields. This migration removes
 * legacy display-name objects that may still exist in manager-team records
 * when Atlassian tells us a user profile has changed.
 */
export async function removeStoredProfileData() {
  const teams = await listKvsRecords(TEAM_KEY_PREFIX);
  await Promise.all(teams.map(async ({ key, value }) => {
    const members = value?.members || [];
    const accountIds = members
      .map(member => typeof member === 'string' ? member : member?.accountId)
      .filter(memberId => typeof memberId === 'string');
    if (members.some(member => typeof member !== 'string')) {
      await kvs.set(key, { members: accountIds });
    }
  }));
}

async function eraseAccountFromApprovalLogs(accountId) {
  const logs = await listKvsRecords(APPROVAL_LOG_KEY_PREFIX);
  await Promise.all(logs.map(async ({ key, value }) => {
    const entries = Array.isArray(value) ? value : [];
    const anonymised = entries.map(entry => {
      if (entry.managerId !== accountId && entry.targetUserId !== accountId) return entry;
      return {
        ...entry,
        managerId: entry.managerId === accountId ? null : entry.managerId,
        targetUserId: entry.targetUserId === accountId ? null : entry.targetUserId,
      };
    });
    if (JSON.stringify(entries) !== JSON.stringify(anonymised)) {
      await kvs.set(key, anonymised);
    }
  }));
}

async function eraseAccountAdjustments(accountId) {
  const entity = kvs.entity('user-monthly-adjustment');
  let cursor;
  do {
    let query = entity.query().index('by-account').where(WhereConditions.equalTo(accountId)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    await Promise.all(page.results.map(record => entity.delete(record.key)));
    cursor = page.nextCursor;
  } while (cursor);
}

async function eraseAccountFromIssues(accountId) {
  // Scanning all KUP issues also removes historical approval/audit references
  // where the closed account belonged to a manager rather than the assignee.
  let nextPageToken;
  do {
    const response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: 'issue.property[kup-data].kupMonth IS NOT EMPTY',
        fields: ['assignee'],
        properties: ['kup-approval', 'kup-audit-log'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Unable to locate KUP issue records (${response.status})`);

    const data = await response.json();
    for (const issue of data.issues || []) {
      const assigneeId = issue.fields?.assignee?.accountId;
      if (assigneeId === accountId) {
        await Promise.all(['kup-data', 'kup-approval', 'kup-audit-log'].map(async property => {
          const deletion = await api.asApp().requestJira(
            route`/rest/api/3/issue/${issue.key}/properties/${property}`,
            { method: 'DELETE' }
          );
          if (!deletion.ok && deletion.status !== 404) {
            throw new Error(`Unable to erase issue property (${deletion.status})`);
          }
        }));
        continue;
      }

      const properties = issue.properties || {};
      const approval = properties['kup-approval'];
      if (approval?.approvedBy === accountId) {
        await api.asApp().requestJira(route`/rest/api/3/issue/${issue.key}/properties/kup-approval`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...approval, approvedBy: null }),
        });
      }
      const auditLog = properties['kup-audit-log'];
      if (Array.isArray(auditLog)) {
        const retainedEntries = auditLog.filter(entry => entry?.userId !== accountId);
        if (retainedEntries.length !== auditLog.length) {
          await api.asApp().requestJira(route`/rest/api/3/issue/${issue.key}/properties/kup-audit-log`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(retainedEntries),
          });
        }
      }
    }
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);
}

/**
 * Erase every location that links app data to an account. The privacy registry
 * is removed last, so a thrown error leaves the account discoverable for a
 * retry on the next scheduled invocation.
 */
export async function erasePersonalData(accountId) {
  const config = await kvs.get('kup_config');
  if (config?.managerUsers?.includes(accountId)) {
    await kvs.set('kup_config', {
      ...config,
      managerUsers: config.managerUsers.filter(id => id !== accountId),
    });
  }

  await Promise.all([
    eraseAccountFromTeams(accountId),
    eraseAccountFromApprovalLogs(accountId),
    eraseAccountAdjustments(accountId),
    // A one-hour export cannot be selectively redacted. Deleting active
    // exports is the safe and bounded response to a right-to-erasure request.
    listKvsRecords(EXPORT_KEY_PREFIX).then(records => Promise.all(records.map(record => kvs.delete(record.key)))),
  ]);
  await eraseAccountFromIssues(accountId);
  await removePrivacyAccount(accountId);
}
