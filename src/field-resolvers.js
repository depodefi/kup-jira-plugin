import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const fieldResolver = new Resolver();

fieldResolver.define('getAvailableMonths', async () => {
  const config = await storage.get('kup_config');
  return (config && config.availableMonths) ? config.availableMonths : [];
});

fieldResolver.define('isKupEligible', async ({ context }) => {
  const issueId = context.extension?.issue?.id;
  if (!issueId) return false;

  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}?fields=project,issuetype`);
    if (!res.ok) return false;
    
    const issueData = await res.json();
    const projectId = issueData.fields.project.id;
    const issueTypeId = issueData.fields.issuetype.id;

    const config = await storage.get('kup_config');
    if (!config) return false;

    if (config.enableAll === true) return true;

    if (!config.enabledProjects || !config.enabledProjects.includes(projectId)) return false;

    const projectIssueTypes = config.projectSpecificIssueTypes?.[projectId] || [];
    // If empty array, it means all issue types are allowed for this project
    if (projectIssueTypes.length === 0) return true;

    return projectIssueTypes.includes(issueTypeId);
  } catch (err) {
    console.error('Error checking KUP eligibility:', err);
    return false;
  }
});

export const fieldHandler = fieldResolver.getDefinitions();
