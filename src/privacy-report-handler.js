import { privacy } from '@forge/api';
import kvs from '@forge/kvs';
import {
  getPrivacyAccountPage,
  isDueForPrivacyReport,
  markAccountsReported,
} from './privacy-data.js';
import { erasePersonalData, removeStoredProfileData } from './privacy-erasure.js';
import { seedPrivacyRegistry } from './privacy-discovery.js';
import { createRequestId, logSafe, safeErrorCode } from './safe-logger.js';

const CURSOR_KEY = 'kup_privacy_reporting_cursor';
const PENDING_UPDATES_KEY = 'kup_privacy_pending_updates';
const REGISTRY_SEEDED_KEY = 'kup_privacy_registry_seeded';

async function processPendingUpdates() {
  const pendingUpdates = await kvs.get(PENDING_UPDATES_KEY) || [];
  const remainingUpdates = [];

  for (const update of pendingUpdates) {
    try {
      if (update.status === 'closed') await erasePersonalData(update.accountId);
      if (update.status === 'updated') await removeStoredProfileData();
    } catch (error) {
      remainingUpdates.push(update);
    }
  }

  if (remainingUpdates.length > 0) await kvs.set(PENDING_UPDATES_KEY, remainingUpdates);
  else await kvs.delete(PENDING_UPDATES_KEY);
}

/**
 * Report a cursor page of retained account IDs to Atlassian. The trigger runs
 * hourly, but each account is reported at most once every seven days. Cursor
 * state makes the job resumable and keeps one invocation bounded to 90 users.
 *
 * Deletion and refresh responses are deliberately kept pending until the
 * cross-store erasure handler is installed. We never discard the registry
 * record before its related KUP data has been erased.
 */
export async function privacyReportHandler() {
  const requestId = createRequestId();
  const cursor = await kvs.get(CURSOR_KEY);

  try {
    if (!await kvs.get(REGISTRY_SEEDED_KEY)) {
      await seedPrivacyRegistry();
      await kvs.set(REGISTRY_SEEDED_KEY, new Date().toISOString());
    }
    await processPendingUpdates();
    const page = await getPrivacyAccountPage(cursor);
    const accounts = page.results.map(result => result.value);
    const dueAccounts = accounts.filter(account => isDueForPrivacyReport(account));

    if (dueAccounts.length > 0) {
      const updates = await privacy.reportPersonalData(dueAccounts.map(account => ({
        accountId: account.accountId,
        updatedAt: account.updatedAt,
      })));

      // A response still counts as a report. Mark every submitted account so
      // a closed account is not sent again on the next hourly invocation; the
      // pending-action queue drives the separate, retryable erasure workflow.
      await markAccountsReported(dueAccounts);

      if (updates.length > 0) {
        const pendingUpdates = await kvs.get(PENDING_UPDATES_KEY) || [];
        const mergedUpdates = [...pendingUpdates];
        for (const update of updates) {
          const existingIndex = mergedUpdates.findIndex(existing => existing.accountId === update.accountId);
          if (existingIndex >= 0) mergedUpdates[existingIndex] = update;
          else mergedUpdates.push(update);
        }
        await kvs.set(PENDING_UPDATES_KEY, mergedUpdates);
        await processPendingUpdates();
        logSafe('warn', 'privacyReport', {
          requestId,
          accountsReported: dueAccounts.length,
          accountsRequiringAction: updates.length,
          status: 'pending_action',
        });
      }
    }

    if (page.nextCursor) await kvs.set(CURSOR_KEY, page.nextCursor);
    else await kvs.delete(CURSOR_KEY);

    logSafe('info', 'privacyReport', {
      requestId,
      accountsScanned: accounts.length,
      accountsReported: dueAccounts.length,
      status: 'success',
    });
  } catch (error) {
    logSafe('error', 'privacyReport', {
      requestId,
      errorCode: safeErrorCode(error),
      status: 'error',
    });
    throw error;
  }
}
