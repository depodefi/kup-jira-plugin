import { kupPanelHandler } from './panel-resolvers';
import api from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => ({
  route: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
  asApp: jest.fn().mockReturnThis(),
  requestJira: jest.fn(),
}));

jest.mock('@forge/kvs', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));

function invoke(functionKey, payload = {}) {
  return kupPanelHandler({
    context: {
      extension: { issue: { id: '10001' }, project: { id: '10000' }, issueType: { id: '10002' } },
    },
    contextToken: 'token',
    call: { functionKey, payload },
  }, {
    principal: {
      accountId: 'user-001',
    },
  });
}

describe('panelResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects malformed months before making Jira writes', async () => {
    const result = await invoke('saveKupData', { kupMonth: 'March 2026', kupHours: 8 });

    expect(result).toEqual({ success: false, error: 'Invalid month format' });
    expect(api.requestJira).not.toHaveBeenCalled();
  });

  it('rejects hours outside the supported monthly range', async () => {
    const result = await invoke('saveKupData', { kupMonth: '2026-03-KUP', kupHours: 745 });

    expect(result).toEqual({ success: false, error: 'KUP hours must be a number between 0 and 744.' });
    expect(api.requestJira).not.toHaveBeenCalled();
  });
});
