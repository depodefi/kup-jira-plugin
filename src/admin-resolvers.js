import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

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
  return config || { enabledProjects: [], enabledIssueTypes: [] };
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
