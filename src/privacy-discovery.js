import api, { route } from '@forge/api';
import kvs, { WhereConditions } from '@forge/kvs';
import { trackPersonalData } from './privacy-data.js';

async function readKvsPrefix(prefix) {
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

/**
 * One-time migration for installations created before the privacy registry.
 * It discovers existing account references without retaining names or issue
 * content, then registers the IDs for subsequent reporting and erasure.
 */
export async function seedPrivacyRegistry() {
  const accountIds = new Set();
  const add = accountId => {
    if (typeof accountId === 'string' && accountId !== 'unknown') accountIds.add(accountId);
  };
  const config = await kvs.get('kup_config') || {};
  (config.managerUsers || []).forEach(add);

  const [teams, approvalLogs] = await Promise.all([
    readKvsPrefix('kup_manager_team_'),
    readKvsPrefix('kup_approval_log_'),
  ]);
  teams.forEach(({ key, value }) => {
    add(key.slice('kup_manager_team_'.length));
    (value?.members || []).forEach(member => add(typeof member === 'string' ? member : member?.accountId));
  });
  approvalLogs.forEach(({ value }) => (value || []).forEach(entry => {
    add(entry.managerId);
    add(entry.targetUserId);
  }));

  // Adjustments are indexed by reporting month. Walking the configured months
  // discovers both the employee and the editor recorded on each adjustment.
  const adjustmentMonths = [...new Set([
    ...(config.availableMonths || []),
    ...Object.keys(config.monthWorkingHours || {}),
  ])];
  const adjustmentEntity = kvs.entity('user-monthly-adjustment');
  for (const month of adjustmentMonths) {
    let cursor;
    do {
      let query = adjustmentEntity.query().index('by-month').where(WhereConditions.equalTo(month)).limit(100);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      page.results.forEach(record => {
        add(record.value?.accountId);
        add(record.value?.updatedBy);
      });
      cursor = page.nextCursor;
    } while (cursor);
  }

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
    if (!response.ok) throw new Error(`Unable to discover stored KUP records (${response.status})`);
    const data = await response.json();
    (data.issues || []).forEach(issue => {
      add(issue.fields?.assignee?.accountId);
      add(issue.properties?.['kup-approval']?.approvedBy);
      (issue.properties?.['kup-audit-log'] || []).forEach(entry => add(entry.userId));
    });
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  await trackPersonalData([...accountIds]);
}
