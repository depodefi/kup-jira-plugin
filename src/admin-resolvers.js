import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const DEFAULT_WORKING_HOURS = {
  "2025-01-KUP":168,"2025-02-KUP":160,"2025-03-KUP":168,"2025-04-KUP":168,"2025-05-KUP":160,"2025-06-KUP":160,
  "2025-07-KUP":184,"2025-08-KUP":160,"2025-09-KUP":176,"2025-10-KUP":184,"2025-11-KUP":144,"2025-12-KUP":168,
  "2026-01-KUP":160,"2026-02-KUP":160,"2026-03-KUP":176,"2026-04-KUP":168,"2026-05-KUP":160,"2026-06-KUP":168,
  "2026-07-KUP":184,"2026-08-KUP":160,"2026-09-KUP":176,"2026-10-KUP":176,"2026-11-KUP":160,"2026-12-KUP":168,
  "2027-01-KUP":152,"2027-02-KUP":160,"2027-03-KUP":176,"2027-04-KUP":176,"2027-05-KUP":144,"2027-06-KUP":176,
  "2027-07-KUP":176,"2027-08-KUP":176,"2027-09-KUP":176,"2027-10-KUP":168,"2027-11-KUP":160,"2027-12-KUP":176,
  "2028-01-KUP":152,"2028-02-KUP":168,"2028-03-KUP":184,"2028-04-KUP":152,"2028-05-KUP":168,"2028-06-KUP":168,
  "2028-07-KUP":168,"2028-08-KUP":176,"2028-09-KUP":168,"2028-10-KUP":176,"2028-11-KUP":160,"2028-12-KUP":152,
  "2029-01-KUP":168,"2029-02-KUP":160,"2029-03-KUP":176,"2029-04-KUP":160,"2029-05-KUP":160,"2029-06-KUP":168,
  "2029-07-KUP":176,"2029-08-KUP":176,"2029-09-KUP":160,"2029-10-KUP":184,"2029-11-KUP":168,"2029-12-KUP":152,
  "2030-01-KUP":176,"2030-02-KUP":160,"2030-03-KUP":168,"2030-04-KUP":168,"2030-05-KUP":168,"2030-06-KUP":152,
  "2030-07-KUP":184,"2030-08-KUP":168,"2030-09-KUP":168,"2030-10-KUP":184,"2030-11-KUP":152,"2030-12-KUP":160,
};

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

  const monthWorkingHours = config?.monthWorkingHours || DEFAULT_WORKING_HOURS;

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
