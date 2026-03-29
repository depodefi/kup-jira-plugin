import Resolver from '@forge/resolver';
import { storage } from '@forge/api';
import api, { route } from '@forge/api';

const kupReportResolver = new Resolver();

// 1. Get available months config for the dropdown
kupReportResolver.define('getAvailableMonths', async () => {
  const config = await storage.get('kup_config');
  let availableMonths = config?.availableMonths;
  
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = [];
    for (let m = 1; m <= 12; m++) {
      availableMonths.push(`2026-${String(m).padStart(2, '0')}-KUP`);
    }
  }
  return availableMonths;
});

// 2. Run JQL to fetch all issues assigned to current user matching the specified month
kupReportResolver.define('getMyKupReport', async ({ payload, context }) => {
  const { month } = payload;
  if (!month) {
    return { issues: [], totalHours: 0 };
  }

  // JQL specifically filtering for the current user and the Entity Property match
  // Since Jira doesn't let us dynamically inject properties into JQL generically, 
  // we configured "kupMonth" and "kupHours" as indexed properties in manifest.yml
  // Use context.accountId instead of currentUser() in JQL when using asApp()
  const accountId = context.accountId;
  const jql = `assignee = "${accountId}" AND issue.property[kup-data].kupMonth = "${month}"`;
  
  try {
    // Using asApp() to avoid forcing every user to click "Allow access" just for the search
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields: ['summary', 'issuetype'], properties: ['kup-data'], maxResults: 100 }),
    });
    
    if (!res.ok) {
      console.warn("Failed to fetch JQL search:", res.status, await res.text());
      return { issues: [], totalHours: 0 };
    }

    const data = await res.json();
    let totalHours = 0;

    const mappedIssues = data.issues.map(issue => {
      // Safely extract the hours from the included properties
      const props = issue.properties || {};
      const kupData = props['kup-data'] || {};
      const hours = parseFloat(kupData.kupHours) || 0;
      
      totalHours += hours;

      return {
        key: issue.key,
        summary: issue.fields?.summary || 'Unknown Summary',
        hours: hours,
      };
    });

    return {
      issues: mappedIssues,
      totalHours: totalHours
    };
  } catch (err) {
    console.warn("Exception during JQL fetch", err);
    return { issues: [], totalHours: 0 };
  }
});

export const kupReportHandler = kupReportResolver.getDefinitions();
