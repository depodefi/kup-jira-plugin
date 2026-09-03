import kvs, { WhereConditions } from '@forge/kvs';

// Atlassian account IDs are identifiers for personal data. Keeping one small,
// queryable registry gives the privacy job a reliable way to find every person
// for whom this installation currently retains app data.
const ACCOUNT_KEY_PREFIX = 'kup_privacy_account_';
const ACCOUNT_ID_REGEX = /^[a-zA-Z0-9:-]{1,128}$/;

function accountKey(accountId) {
  return `${ACCOUNT_KEY_PREFIX}${accountId}`;
}

function isTrackableAccountId(accountId) {
  return typeof accountId === 'string'
    && accountId !== 'unknown'
    && ACCOUNT_ID_REGEX.test(accountId);
}

/**
 * Register the account IDs covered by newly persisted app data. `updatedAt`
 * records when the app first obtained the oldest retained user data, which is
 * the timestamp Atlassian requires when reporting personal-data storage.
 */
export async function trackPersonalData(accountIds, updatedAt = new Date().toISOString()) {
  const ids = [...new Set((accountIds || []).filter(isTrackableAccountId))];

  await Promise.all(ids.map(async accountId => {
    const key = accountKey(accountId);
    const existing = await kvs.get(key);
    const existingUpdatedAt = existing?.updatedAt;
    const oldestUpdatedAt = existingUpdatedAt && existingUpdatedAt < updatedAt
      ? existingUpdatedAt
      : updatedAt;

    await kvs.set(key, {
      accountId,
      updatedAt: oldestUpdatedAt,
      lastReportedAt: existing?.lastReportedAt || null,
    });
  }));
}

/**
 * Return one cursor page from the registry. The scheduled handler stores the
 * cursor between invocations, allowing a large installation to be processed
 * incrementally without exceeding a Forge function's execution window.
 */
export async function getPrivacyAccountPage(cursor) {
  let query = kvs.query()
    .where('key', WhereConditions.beginsWith(ACCOUNT_KEY_PREFIX))
    .limit(90);
  if (cursor) query = query.cursor(cursor);
  return query.getMany();
}

export async function markAccountsReported(accounts, reportedAt = new Date().toISOString()) {
  await Promise.all(accounts.map(async account => {
    await kvs.set(accountKey(account.accountId), {
      ...account,
      lastReportedAt: reportedAt,
    });
  }));
}

export async function removePrivacyAccount(accountId) {
  await kvs.delete(accountKey(accountId));
}

export function isDueForPrivacyReport(account, now = Date.now()) {
  if (!account?.lastReportedAt) return true;
  return now - Date.parse(account.lastReportedAt) >= 7 * 24 * 60 * 60 * 1000;
}
