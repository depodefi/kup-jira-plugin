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

describe('exportAsyncHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores a safe error message instead of exposing the raw exception', async () => {
    kvs.get.mockResolvedValueOnce({});
    api.requestJira.mockRejectedValueOnce(new Error('sensitive Jira response details'));

    await exportAsyncHandler({
      body: { month: '2026-03-KUP', format: 'csv', requestedBy: 'manager-001' },
    });

    expect(kvs.set).toHaveBeenCalledWith(
      'export_manager-001_2026-03-KUP',
      expect.objectContaining({
        status: 'error',
        message: 'The payroll export could not be generated. Please try again or contact an administrator.',
      }),
      expect.anything(),
    );
    expect(kvs.set.mock.calls[0][1].message).not.toContain('sensitive Jira response details');
  });

  it('generates an XLSX buffer without the vulnerable xlsx package', async () => {
    kvs.get.mockResolvedValueOnce({ monthWorkingHours: { '2026-03-KUP': 176 } });
    api.requestJira.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issues: [{
          fields: { assignee: { accountId: 'employee-001', displayName: 'Ada Lovelace' } },
          properties: {
            'kup-data': { kupHours: 8 },
            'kup-approval': { status: 'approved' },
          },
        }],
      }),
    });

    await exportAsyncHandler({
      body: { month: '2026-03-KUP', format: 'xlsx', requestedBy: 'manager-001' },
    });

    const storedExport = kvs.set.mock.calls[0][1];
    expect(storedExport.format).toBe('xlsx');
    expect(storedExport.filename).toBe('KUP_Payroll_2026-03-KUP.xlsx');
    // XLSX files are ZIP containers and therefore start with the PK signature.
    expect(Buffer.from(storedExport.data, 'base64').subarray(0, 2).toString()).toBe('PK');
  });
});
