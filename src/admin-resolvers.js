import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';
import { DEFAULT_WORKING_HOURS } from './kup-defaults.js';

const adminResolver = new Resolver();

// Fetch available Projects and Issue Types
adminResolver.define('getJiraContext', async () => {
  // Fetch Projects
  const projectsRes = await api.asApp().requestJira(route`/rest/api/3/project/search`);
  const projectsData = await projectsRes.json();
  const projects = projectsData.values.map(p => ({
    id: p.id,
    key: p.key,
    name: p.name,
  }));

  // Fetch Issue Types
  const issueTypesRes = await api.asApp().requestJira(route`/rest/api/3/issuetype`);
  const issueTypesData = await issueTypesRes.json();
  const issueTypes = issueTypesData.map(it => ({
    id: it.id,
    name: it.name,
  }));

  return { projects, issueTypes };
});

// Get currently saved KUP configuration
adminResolver.define('getKupConfig', async () => {
  const config = await storage.get('kup_config');
  
  let availableMonths = config?.availableMonths;
  // If undefined or empty (first install/never configured), default to all of 2026
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = [];
    for (let m = 1; m <= 12; m++) {
      availableMonths.push(`2026-${String(m).padStart(2, '0')}-KUP`);
    }
  }

  let monthWorkingHours = config?.monthWorkingHours;
  if (!monthWorkingHours) {
    monthWorkingHours = DEFAULT_WORKING_HOURS;
    await storage.set('kup_config', { ...(config || {}), monthWorkingHours });
  }

  return {
    ...(config || { enabledProjects: [], enabledIssueTypes: [] }),
    availableMonths,
    monthWorkingHours,
    managerUsers: config?.managerUsers || [],
    managerGroups: config?.managerGroups || [],
    maxKupPercent: config?.maxKupPercent ?? null,
    kupLimitEnforcement: config?.kupLimitEnforcement ?? 'warn',
  };
});

// Save KUP configuration
adminResolver.define('saveKupConfig', async ({ payload }) => {
  if (payload) {
    await storage.set('kup_config', payload);
    return { success: true };
  }
  return { success: false, error: 'No payload provided' };
});

// Fetch available Jira groups for the Manager role picker
adminResolver.define('getJiraGroups', async () => {
  const res = await api.asApp().requestJira(route`/rest/api/3/groups/picker?query=&maxResults=50`);
  const data = await res.json();
  return (data.groups || []).map(g => ({ groupId: g.groupId, name: g.name }));
});

// Evaluate whether the current user holds the KUP Manager role
adminResolver.define('getCurrentUserRole', async ({ context }) => {
  const accountId = context.accountId;
  const config = await storage.get('kup_config');
  const managerUsers = config?.managerUsers || [];
  const managerGroups = config?.managerGroups || [];

  if (managerUsers.includes(accountId)) return { isManager: true };
  if (managerGroups.length === 0) return { isManager: false };

  const res = await api.asApp().requestJira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  if (!res.ok) return { isManager: false };

  const userGroups = await res.json();
  const userGroupIds = userGroups.map(g => g.groupId);
  return { isManager: managerGroups.some(gid => userGroupIds.includes(gid)) };
});

export const adminHandler = adminResolver.getDefinitions();
