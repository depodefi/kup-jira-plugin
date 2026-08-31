import { exportAsyncHandler } from './export-async-handler';
import api from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => ({
  route: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
  asApp: jest.fn().mockReturnThis(),
  requestJira: jest.fn(),
}));

jest.mock('@forge/kvs', () => {
  const queryBuilder = {
    index: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
  };
  const entity = { query: jest.fn(() => queryBuilder) };
  return {
    __esModule: true,
    default: { get: jest.fn(), set: jest.fn(), delete: jest.fn(), entity: jest.fn(() => entity) },
    WhereConditions: { equalTo: jest.fn(value => value) },
  };
});

/**
 * This is intentionally a Jest load test rather than a live Jira benchmark.
 * It exercises the complete export aggregation and pagination path with a
 * representative 1,000-employee / 5,000-issue data set without requiring a
 * customer site or external network access.
 */
describe('exportAsyncHandler load profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates 5,000 issues across 50 Jira pages', async () => {
    const issueCount = 5000;
    const pageSize = 100;
    const issues = Array.from({ length: issueCount }, (_, index) => {
      const employeeNumber = Math.floor(index / 5);
      return {
        key: `KUP-${index + 1}`,
        fields: {
          assignee: {
            accountId: `employee-${employeeNumber}`,
            displayName: `Employee ${employeeNumber}`,
          },
        },
        properties: {
          'kup-data': { kupHours: 2 },
          'kup-approval': { status: 'approved' },
        },
      };
    });

    let searchPage = 0;
    kvs.get.mockResolvedValueOnce({
      monthWorkingHours: { '2026-03-KUP': 176 },
      maxKupPercent: null,
    });
    api.requestJira.mockImplementation(async () => {
      const page = issues.slice(searchPage * pageSize, (searchPage + 1) * pageSize);
      searchPage += 1;
      return {
        ok: true,
        json: async () => ({
          issues: page,
          ...(page.length === pageSize && searchPage < issueCount / pageSize
            ? { nextPageToken: `page-${searchPage}` }
            : {}),
        }),
      };
    });

    const startedAt = Date.now();
    await exportAsyncHandler({
      body: { month: '2026-03-KUP', format: 'csv', requestedBy: 'manager-001' },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(searchPage).toBe(50);
    expect(api.requestJira).toHaveBeenCalledTimes(50);
    expect(kvs.set).toHaveBeenCalledWith(
      'export_manager-001_2026-03-KUP',
      expect.objectContaining({ format: 'csv', filename: 'KUP_Payroll_2026-03-KUP.csv' }),
      expect.anything(),
    );
    expect(kvs.set.mock.calls[0][1].data.length).toBeGreaterThan(1000);
    // This threshold is intentionally generous for shared CI machines; a
    // regression that takes several seconds should still fail visibly.
    expect(elapsedMs).toBeLessThan(10000);
  });
});
