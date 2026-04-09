import { adminHandler } from './admin-resolvers';
import api, { storage } from '@forge/api';

jest.mock('@forge/api', () => {
  return {
    route: (strings, ...values) => strings[0] + values.join(''),
    storage: {
      get: jest.fn(),
      set: jest.fn()
    },
    asApp: jest.fn().mockReturnThis(),
    requestJira: jest.fn()
  };
});

describe('adminResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getJiraContext should return projects and issue types', async () => {
    // Mock the chained api.asApp().requestJira(...) responses
    api.requestJira
      .mockResolvedValueOnce({
        json: async () => ({
          values: [{ id: '10000', key: 'PROJ', name: 'Project 1' }]
        })
      })
      .mockResolvedValueOnce({
        json: async () => ([
          { id: '1', name: 'Bug' },
          { id: '2', name: 'Task' }
        ])
      });

    // Execute the handler
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      payload: {},
      call: { functionKey: 'getJiraContext' }
    });

    expect(result.projects).toEqual([{ id: '10000', key: 'PROJ', name: 'Project 1' }]);
    expect(result.issueTypes).toEqual([{ id: '1', name: 'Bug' }, { id: '2', name: 'Task' }]);
    expect(api.requestJira).toHaveBeenCalledTimes(2);
  });

  it('getKupConfig should return stored config', async () => {
    storage.get.mockResolvedValueOnce({ enabledProjects: ['PROJ'], enabledIssueTypes: ['1'] });

    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      payload: {},
      call: { functionKey: 'getKupConfig' }
    });

    expect(result).toEqual(expect.objectContaining({ enabledProjects: ['PROJ'], enabledIssueTypes: ['1'] }));
    expect(storage.get).toHaveBeenCalledWith('kup_config');
  });

  it('saveKupConfig should save config and return success', async () => {
    storage.set.mockResolvedValueOnce();

    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      payload: { enabledProjects: ['PROJ'], enabledIssueTypes: ['1'] },
      call: { functionKey: 'saveKupConfig' }
    });

    expect(result).toEqual({ success: true });
    expect(storage.set).toHaveBeenCalledWith('kup_config', expect.anything());
  });
});
