import { privacyReportHandler } from './privacy-report-handler';
import { getAppContext, privacy } from '@forge/api';
import kvs from '@forge/kvs';
import * as privacyErasure from './privacy-erasure.js';

jest.mock('@forge/api', () => ({
  getAppContext: jest.fn(),
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
    getAppContext.mockReturnValue({ environmentType: 'DEVELOPMENT' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it.each([
    ['inactive', { active: false }],
    ['missing', undefined],
  ])('continues reporting and queued erasure with a production license that is %s', async (_state, license) => {
    getAppContext.mockReturnValue({ environmentType: 'PRODUCTION', license });
    // Keep erasure's cross-store implementation covered by its own suite; this
    // regression verifies that the scheduled handler still dispatches it when
    // the installation no longer has access to paid product functionality.
    const erase = jest.spyOn(privacyErasure, 'erasePersonalData').mockResolvedValue(undefined);
    kvs.get.mockImplementation(async key => {
      if (key === 'kup_privacy_registry_seeded') return '2026-01-01T00:00:00.000Z';
      if (key === 'kup_privacy_pending_updates') {
        return [{ accountId: 'closed-user', status: 'closed' }];
      }
      return undefined;
    });
    kvs.query().getMany.mockResolvedValue({
      results: [{
        key: 'kup_privacy_account_user-001',
        value: { accountId: 'user-001', updatedAt: '2026-01-01T00:00:00.000Z', lastReportedAt: null },
      }],
      nextCursor: undefined,
    });
    privacy.reportPersonalData.mockResolvedValue([]);

    await privacyReportHandler();

    expect(erase).toHaveBeenCalledWith('closed-user');
    expect(kvs.delete).toHaveBeenCalledWith('kup_privacy_pending_updates');
    expect(privacy.reportPersonalData).toHaveBeenCalledWith([{
      accountId: 'user-001',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
  });
});
