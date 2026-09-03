import { erasePersonalData } from './privacy-erasure';
import api from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => {
  const api = {
    asApp: jest.fn(),
    requestJira: jest.fn(),
  };
  api.asApp.mockReturnValue(api);
  return {
    __esModule: true,
    default: api,
    route: (strings, ...values) => strings.reduce((url, part, index) => url + part + (values[index] ?? ''), ''),
  };
});

jest.mock('@forge/kvs', () => {
  const query = {
    where: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    index: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
  };
  const entity = { query: jest.fn(() => query), delete: jest.fn() };
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      query: jest.fn(() => query),
      entity: jest.fn(() => entity),
    },
    WhereConditions: {
      beginsWith: jest.fn(value => value),
      equalTo: jest.fn(value => value),
    },
  };
});

describe('erasePersonalData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes the closed account’s KUP records and registry entry', async () => {
    kvs.get.mockResolvedValue({ managerUsers: ['closed-user', 'manager-002'] });
    api.requestJira
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [{ key: 'KUP-1', fields: { assignee: { accountId: 'closed-user' } }, properties: {} }],
          nextPageToken: undefined,
        }),
      })
      .mockResolvedValue({ ok: true, status: 204 });

    await erasePersonalData('closed-user');

    expect(kvs.set).toHaveBeenCalledWith('kup_config', {
      managerUsers: ['manager-002'],
    });
    expect(api.requestJira).toHaveBeenCalledWith(
      '/rest/api/3/issue/KUP-1/properties/kup-data',
      { method: 'DELETE' },
    );
    expect(api.requestJira).toHaveBeenCalledWith(
      '/rest/api/3/issue/KUP-1/properties/kup-approval',
      { method: 'DELETE' },
    );
    expect(api.requestJira).toHaveBeenCalledWith(
      '/rest/api/3/issue/KUP-1/properties/kup-audit-log',
      { method: 'DELETE' },
    );
    expect(kvs.delete).toHaveBeenCalledWith('kup_privacy_account_closed-user');
  });
});
