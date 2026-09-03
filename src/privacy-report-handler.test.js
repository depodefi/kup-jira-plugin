import { privacyReportHandler } from './privacy-report-handler';
import { privacy } from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => ({
  privacy: { reportPersonalData: jest.fn() },
}));

jest.mock('@forge/kvs', () => {
  const query = {
    where: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      query: jest.fn(() => query),
    },
    WhereConditions: { beginsWith: jest.fn(value => value) },
  };
});

describe('privacyReportHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports due accounts and records the successful reporting time', async () => {
    kvs.get
      .mockResolvedValueOnce(undefined) // reporting cursor
      .mockResolvedValueOnce('2026-01-01T00:00:00.000Z'); // registry already seeded
    kvs.query().getMany.mockResolvedValue({
      results: [{
        key: 'kup_privacy_account_user-001',
        value: { accountId: 'user-001', updatedAt: '2026-01-01T00:00:00.000Z', lastReportedAt: null },
      }],
      nextCursor: undefined,
    });
    privacy.reportPersonalData.mockResolvedValue([]);

    await privacyReportHandler();

    expect(privacy.reportPersonalData).toHaveBeenCalledWith([{
      accountId: 'user-001',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    expect(kvs.set).toHaveBeenCalledWith(
      'kup_privacy_account_user-001',
      expect.objectContaining({ accountId: 'user-001', lastReportedAt: expect.any(String) }),
    );
    expect(kvs.delete).toHaveBeenCalledWith('kup_privacy_reporting_cursor');
  });

  it('queues an account requiring a privacy action without reporting it again hourly', async () => {
    kvs.get
      .mockResolvedValueOnce(undefined) // reporting cursor
      .mockResolvedValueOnce('2026-01-01T00:00:00.000Z'); // registry already seeded
    kvs.query().getMany.mockResolvedValue({
      results: [{
        key: 'kup_privacy_account_user-001',
        value: { accountId: 'user-001', updatedAt: '2026-01-01T00:00:00.000Z', lastReportedAt: null },
      }],
      nextCursor: undefined,
    });
    privacy.reportPersonalData.mockResolvedValue([{ accountId: 'user-001', status: 'closed' }]);

    await privacyReportHandler();

    expect(kvs.set).toHaveBeenCalledWith('kup_privacy_pending_updates', [
      { accountId: 'user-001', status: 'closed' },
    ]);
    expect(kvs.set).toHaveBeenCalledWith(
      'kup_privacy_account_user-001',
      expect.objectContaining({ lastReportedAt: expect.any(String) }),
    );
  });
});
