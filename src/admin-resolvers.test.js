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
      call: { functionKey: 'saveKupConfig', payload: { enabledProjects: ['PROJ'], enabledIssueTypes: ['1'] } }
    });

    expect(result).toEqual({ success: true });
    expect(storage.set).toHaveBeenCalledWith('kup_config', expect.anything());
  });

  it('saveKupConfig accepts a full valid config payload', async () => {
    storage.set.mockResolvedValueOnce();

    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: {
        enableAll: false,
        enabledProjects: ['10000'],
        projectSpecificIssueTypes: { '10000': ['1', '2'] },
        availableMonths: ['2026-01-KUP', '2026-02-KUP'],
        monthWorkingHours: { '2026-01-KUP': 168 },
        managerUsers: ['557058:abc-def'],
        managerGroups: ['9f0c2a4e-1b2c-4d5e-8f90-aabbccddeeff'],
        maxKupPercent: 20,
        kupLimitEnforcement: 'block',
        exportFieldMappings: { employeeId: 'customfield_10050', costCenter: null },
      } }
    });

    expect(result).toEqual({ success: true });
    expect(storage.set).toHaveBeenCalledWith('kup_config', expect.anything());
  });

  it('saveKupConfig rejects unknown config keys', async () => {
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: { enableAll: true, injected: 'junk' } }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('injected');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('saveKupConfig rejects malformed availableMonths entries', async () => {
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: { availableMonths: ['2026-01-KUP', 'not-a-month'] } }
    });

    expect(result.success).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('saveKupConfig rejects out-of-range working hours', async () => {
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: { monthWorkingHours: { '2026-01-KUP': 999 } } }
    });

    expect(result.success).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('saveKupConfig rejects invalid exportFieldMappings values', async () => {
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: { exportFieldMappings: { employeeId: 'summary' } } }
    });

    expect(result.success).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('saveKupConfig rejects invalid kupLimitEnforcement values', async () => {
    const result = await adminHandler({
      context: {},
      contextToken: 'token',
      call: { functionKey: 'saveKupConfig', payload: { kupLimitEnforcement: 'ignore' } }
    });

    expect(result.success).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
