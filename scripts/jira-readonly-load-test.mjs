#!/usr/bin/env node

/**
 * Read-only Jira traffic generator for validating report/search behaviour on
 * a real customer test instance. It never creates, edits, or deletes Jira
 * data. Credentials are read only from environment variables and are never
 * printed.
 *
 * Required environment variables:
 *   JIRA_BASE_URL       e.g. https://veloscope.atlassian.net
 *   JIRA_EMAIL          Atlassian account email used for the API token
 *   JIRA_API_TOKEN      Atlassian API token
 *
 * Optional environment variables:
 *   KUP_MONTH           Defaults to 2026-03-KUP
 *   LOAD_REQUESTS       Defaults to 100 total requests
 *   LOAD_CONCURRENCY    Defaults to 10 concurrent requests
 *   JIRA_GROUP_ID       If set, every request also reads one group-member page
 *   GROUP_PAGE_SIZE     Defaults to 200
 */

const baseUrl = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const email = process.env.JIRA_EMAIL;
const apiToken = process.env.JIRA_API_TOKEN;
const month = process.env.KUP_MONTH || '2026-03-KUP';
const requestCount = Number(process.env.LOAD_REQUESTS || 100);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10);
const groupId = process.env.JIRA_GROUP_ID;
const groupPageSize = Number(process.env.GROUP_PAGE_SIZE || 200);

if (!baseUrl || !email || !apiToken) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN before running the test.');
  process.exit(1);
}

if (!/^\d{4}-\d{2}-KUP$/.test(month)) {
  console.error('KUP_MONTH must have the format YYYY-MM-KUP.');
  process.exit(1);
}

if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 10000) {
  console.error('LOAD_REQUESTS must be an integer between 1 and 10000.');
  process.exit(1);
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  console.error('LOAD_CONCURRENCY must be an integer between 1 and 100.');
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
const headers = {
  Authorization: authorization,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function jiraRequest(path, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const elapsedMs = performance.now() - startedAt;
  return { response, elapsedMs };
}

async function runOneRequest(index) {
  // This is the same indexed property query used by the manager report and
  // payroll export, but it is deliberately limited to one read-only page.
  const search = await jiraRequest('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `issue.property[kup-data].kupMonth = "${month}"`,
      fields: ['summary', 'assignee'],
      properties: ['kup-data', 'kup-approval'],
      maxResults: 100,
    }),
  });

  const results = [{
    index,
    endpoint: 'search/jql',
    status: search.response.status,
    elapsedMs: search.elapsedMs,
  }];

  if (groupId) {
    const group = await jiraRequest(
      `/rest/api/3/group/member?groupId=${encodeURIComponent(groupId)}&startAt=0&maxResults=${groupPageSize}`
    );
    results.push({
      index,
      endpoint: 'group/member',
      status: group.response.status,
      elapsedMs: group.elapsedMs,
    });
  }

  return results;
}

async function main() {
  console.log(`Starting read-only Jira load: ${requestCount} requests, concurrency ${concurrency}`);
  console.log(`Target: ${baseUrl}; month: ${month}; group filter: ${groupId ? 'enabled' : 'disabled'}`);

  const startedAt = performance.now();
  const allResults = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= requestCount) return;
      try {
        allResults.push(...await runOneRequest(index));
      } catch (error) {
        allResults.push({ index, endpoint: 'request', status: 'network-error', elapsedMs: 0, error: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));

  const elapsedMs = performance.now() - startedAt;
  const successful = allResults.filter(result => result.status >= 200 && result.status < 300);
  const failed = allResults.filter(result => !successful.includes(result));
  const timings = allResults.map(result => result.elapsedMs).sort((a, b) => a - b);
  const percentile = (fraction) => timings[Math.min(timings.length - 1, Math.floor(timings.length * fraction))] || 0;

  console.log(`Completed ${allResults.length} Jira API calls in ${Math.round(elapsedMs)} ms.`);
  console.log(`Successful: ${successful.length}; failed: ${failed.length}`);
  console.log(`Latency ms — p50: ${Math.round(percentile(0.50))}, p95: ${Math.round(percentile(0.95))}, max: ${Math.round(timings[timings.length - 1] || 0)}`);

  if (failed.length > 0) {
    const byStatus = {};
    for (const result of failed) byStatus[result.status] = (byStatus[result.status] || 0) + 1;
    console.log(`Failures by status: ${JSON.stringify(byStatus)}`);
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(`Load test failed: ${error.message}`);
  process.exitCode = 1;
});
