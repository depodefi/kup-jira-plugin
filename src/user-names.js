import api, { route } from '@forge/api';

const ACCOUNT_ID_REGEX = /^[a-zA-Z0-9:-]{1,128}$/;
export const FORMER_USER = 'Former user';

/**
 * Resolve Atlassian account IDs to display names via the Jira REST API.
 * Returns a Map of accountId -> displayName. Unknown, deactivated, deleted,
 * or malformed accounts resolve to "Former user".
 *
 * Names are resolved live and never persisted — only the stable account ID is
 * stored, which keeps the app out of scope for personal-data retention (#19).
 */
export async function resolveUserNames(accountIds) {
  const unique = [...new Set(
    (accountIds || []).filter(id => typeof id === 'string' && ACCOUNT_ID_REGEX.test(id))
  )];

  const names = new Map();
  await Promise.all(unique.map(async (accountId) => {
    try {
      const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
      if (res.ok) {
        const user = await res.json();
        names.set(accountId, user.displayName || FORMER_USER);
      } else {
        names.set(accountId, FORMER_USER);
      }
    } catch (e) {
      names.set(accountId, FORMER_USER);
    }
  }));
  return names;
}
