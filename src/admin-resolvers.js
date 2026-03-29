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

  return { ...(config || { enabledProjects: [], enabledIssueTypes: [] }), availableMonths, monthWorkingHours };
});

// Save KUP configuration
adminResolver.define('saveKupConfig', async ({ payload }) => {
  if (payload) {
    await storage.set('kup_config', payload);
    return { success: true };
  }
  return { success: false, error: 'No payload provided' };
});

export const adminHandler = adminResolver.getDefinitions();
