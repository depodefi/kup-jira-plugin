import { kupPanelHandler } from './panel-resolvers';
import api from '@forge/api';
import kvs from '@forge/kvs';

jest.mock('@forge/api', () => ({
  getAppContext: () => ({ environmentType: 'DEVELOPMENT' }),
  route: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
  asApp: jest.fn().mockReturnThis(),
  requestJira: jest.fn(),
}));

jest.mock('./privacy-data.js', () => ({ trackPersonalData: jest.fn() }));

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

  it('saves one canonical period with hours and records the change', async () => {
    api.requestJira.mockResolvedValue({ ok: false });
    api.requestJira.mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const result = await invoke('saveKupData', { kupMonth: '2026-09', kupHours: 8 });
    expect(result.success).toBe(true);
    expect(result.kupData).toEqual({ kupMonth: '2026-09', kupHours: 8 });
    expect(api.requestJira).toHaveBeenCalledWith('/rest/api/3/issue/10001/properties/kup-data',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ kupMonth: '2026-09', kupHours: 8 }) }));
    expect(result.auditLog[0].changes.kupMonth).toEqual({ from: null, to: '2026-09' });
  });

  test.each(['2026-00', '2026-13', '2026-09-KUP'])('rejects invalid calendar period %s', async kupMonth => {
    const result = await invoke('saveKupData', { kupMonth, kupHours: 8 });
    expect(result.success).toBe(false);
    expect(api.requestJira).not.toHaveBeenCalled();
  });

  it('rejects hours outside the supported monthly range', async () => {
    const result = await invoke('saveKupData', { kupMonth: '2026-03', kupHours: 745 });

    expect(result).toEqual({ success: false, error: 'KUP hours must be a number between 0 and 744.' });
    expect(api.requestJira).not.toHaveBeenCalled();
  });
});
