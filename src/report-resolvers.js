import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvs from '@forge/kvs';
import { logSafe, safeErrorCode } from './safe-logger.js';
import { resolveWorkingHours, defaultAvailableMonths } from './kup-defaults.js';
import { requireActiveLicense } from './license-guard.js';

import { PERIOD_PATTERN as MONTH_REGEX } from './kup-period.js';

const kupReportResolver = new Resolver();

// 1. Calendar months for the legacy report dropdown
kupReportResolver.define('getAvailableMonths', async () => {
  return defaultAvailableMonths();
});

// 2. Run JQL to fetch all issues assigned to current user matching the specified month
kupReportResolver.define('getMyKupReport', async ({ payload, context }) => {
  const { month } = payload;
  if (!month || !MONTH_REGEX.test(month)) {
    return { issues: [], totalHours: 0, maxWorkingHours: null };
  }

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
      console.warn("Failed to fetch JQL search:", res.status);
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

    const config = await kvs.get('kup_config');
    const workingHoursMap = resolveWorkingHours(config);
    const maxWorkingHours = workingHoursMap[month] ?? null;

    return {
      issues: mappedIssues,
      totalHours,
      maxWorkingHours,
    };
  } catch (err) {
    logSafe('warn', 'legacyReportSearch', { errorCode: safeErrorCode(err), status: 'error' });
    return { issues: [], totalHours: 0 };
  }
});

export const kupReportHandler = requireActiveLicense(kupReportResolver.getDefinitions());
