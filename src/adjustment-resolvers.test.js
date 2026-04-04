import { managerHandler } from './manager-resolvers';
import api, { storage } from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => ({
  route: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
  storage: { get: jest.fn(), set: jest.fn() },
  asApp: jest.fn().mockReturnThis(),
  requestJira: jest.fn(),
}));

jest.mock('@forge/kvs', () => {
  const entity = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };
  return {
    __esModule: true,
    default: { entity: jest.fn(() => entity) },
    _mockEntity: entity,
  };
});

const { _mockEntity: mockEntity } = require('@forge/kvs');

function invoke(functionKey, payload = {}, accountId = 'user-001') {
  return managerHandler(
    { context: {}, contextToken: 'token', call: { functionKey, payload } },
    { principal: { accountId } }
  );
}

const managerConfig = { managerUsers: ['manager-001'], managerGroups: [] };

describe('adjustment resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- getMyAdjustment ---

  it('getMyAdjustment returns defaults when no record exists', async () => {
    mockEntity.get.mockResolvedValueOnce(undefined);

    const result = await invoke('getMyAdjustment', { month: '2026-04-KUP' });

    expect(result).toEqual({ absenceHours: 0, overtimeHours: 0, updatedAt: null });
    expect(mockEntity.get).toHaveBeenCalledWith('user-001_2026-04-KUP');
  });

  it('getMyAdjustment returns stored values', async () => {
    mockEntity.get.mockResolvedValueOnce({
      absenceHours: 40,
      overtimeHours: 16,
      updatedAt: '2026-04-01T10:00:00Z',
    });

    const result = await invoke('getMyAdjustment', { month: '2026-04-KUP' });

    expect(result.absenceHours).toBe(40);
    expect(result.overtimeHours).toBe(16);
    expect(result.updatedAt).toBe('2026-04-01T10:00:00Z');
  });

  // --- saveMyAdjustment ---

  it('saveMyAdjustment writes record for non-zero values', async () => {
    storage.get.mockResolvedValueOnce({ monthWorkingHours: { '2026-04-KUP': 168 } });
    mockEntity.set.mockResolvedValueOnce();

    const result = await invoke('saveMyAdjustment', {
      month: '2026-04-KUP', absenceHours: 40, overtimeHours: 16,
    });

    expect(result).toEqual({ success: true });
    expect(mockEntity.set).toHaveBeenCalledWith(
      'user-001_2026-04-KUP',
      expect.objectContaining({ accountId: 'user-001', month: '2026-04-KUP', absenceHours: 40, overtimeHours: 16 })
    );
  });

  it('saveMyAdjustment deletes record when both values are 0', async () => {
    storage.get.mockResolvedValueOnce({});
    mockEntity.delete.mockResolvedValueOnce();

    const result = await invoke('saveMyAdjustment', {
      month: '2026-04-KUP', absenceHours: 0, overtimeHours: 0,
    });

    expect(result).toEqual({ success: true, deleted: true });
    expect(mockEntity.delete).toHaveBeenCalledWith('user-001_2026-04-KUP');
    expect(mockEntity.set).not.toHaveBeenCalled();
  });

  it('saveMyAdjustment rejects negative absence hours', async () => {
    const result = await invoke('saveMyAdjustment', {
      month: '2026-04-KUP', absenceHours: -1, overtimeHours: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-negative/);
  });

  it('saveMyAdjustment rejects absence hours exceeding max working hours', async () => {
    storage.get.mockResolvedValueOnce({ monthWorkingHours: { '2026-04-KUP': 168 } });

    const result = await invoke('saveMyAdjustment', {
      month: '2026-04-KUP', absenceHours: 200, overtimeHours: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/168/);
  });

  // --- getAdjustmentsForMonth ---

  it('getAdjustmentsForMonth returns Unauthorized for non-managers', async () => {
    storage.get.mockResolvedValueOnce({ managerUsers: [], managerGroups: [] });

    const result = await invoke('getAdjustmentsForMonth', { month: '2026-04-KUP' }, 'dev-001');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('getAdjustmentsForMonth returns adjustments map for managers', async () => {
    storage.get.mockResolvedValueOnce(managerConfig); // checkIsManager

    const mockQueryBuilder = {
      index: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValueOnce({
        results: [
          { value: { accountId: 'dev-001', absenceHours: 40, overtimeHours: 0 } },
          { value: { accountId: 'dev-002', absenceHours: 0, overtimeHours: 16 } },
        ],
        nextCursor: undefined,
      }),
    };
    mockEntity.query.mockReturnValueOnce(mockQueryBuilder);

    const result = await invoke('getAdjustmentsForMonth', { month: '2026-04-KUP' }, 'manager-001');

    expect(result.adjustments).toEqual({
      'dev-001': { absenceHours: 40, overtimeHours: 0 },
      'dev-002': { absenceHours: 0, overtimeHours: 16 },
    });
    expect(mockQueryBuilder.index).toHaveBeenCalledWith('by-month', { partition: ['2026-04-KUP'] });
  });

  it('getAdjustmentsForMonth returns empty map when no adjustments exist', async () => {
    storage.get.mockResolvedValueOnce(managerConfig);

    const mockQueryBuilder = {
      index: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValueOnce({ results: [], nextCursor: undefined }),
    };
    mockEntity.query.mockReturnValueOnce(mockQueryBuilder);

    const result = await invoke('getAdjustmentsForMonth', { month: '2026-04-KUP' }, 'manager-001');
    expect(result).toEqual({ adjustments: {} });
  });
});
