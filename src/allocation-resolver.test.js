import { saveAllocatedHours } from './allocation-resolver.js';
import { splitHours, hourUnits } from './kup-allocation.js';
import api from '@forge/api';
import kvs from '@forge/kvs';
jest.mock('@forge/api', () => ({
  route: (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
  asUser: jest.fn().mockReturnThis(), requestJira: jest.fn(),
}));
jest.mock('@forge/kvs', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('./privacy-data.js', () => ({ trackPersonalData: jest.fn() }));
const run = () => saveAllocatedHours({ payload: { key: 'KUP-1', month: '2026-09', hours: 8 }, context: { accountId: 'user-1' } });
const ok = value => ({ ok: true, json: async () => value });
beforeEach(() => {
  jest.resetAllMocks();
  api.asUser.mockReturnThis();
  kvs.get.mockResolvedValue(undefined);
  api.requestJira.mockResolvedValue(ok({}));
  api.requestJira.mockResolvedValueOnce(ok({ fields: { assignee: { accountId: 'user-1' }, resolutiondate: '2026-09-10', project: { id: '1' }, issuetype: { id: '2' } } }));
});
function properties(data = null, approval = null, audit = null) {
  for (const value of [data, approval, audit]) api.requestJira.mockResolvedValueOnce(value === null ? { status: 404 } : ok({ value }));
}
test('preserves the exact total when splitting indivisible hours', () => {
  expect(splitHours('10', 3)).toEqual([3.34, 3.33, 3.33]);
  expect(splitHours('0.02', 3)).toBeNull();
  expect(hourUnits('1.001')).toBeNull();
  expect(hourUnits('Infinity')).toBeNull();
});
test('saves owner, month, pending approval and audit through user permissions', async () => {
  properties();
  expect(await run()).toEqual({ saved: true });
  const writes = api.requestJira.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(writes).toHaveLength(3);
  expect(JSON.parse(writes[0][1].body)).toEqual({ kupMonth: '2026-09', kupHours: 8, employeeAccountId: 'user-1' });
  expect(JSON.parse(writes[2][1].body)[0].changes.kupHours).toEqual({ from: null, to: 8 });
});
test.each([{ kupHours: 0 }, { kupHours: 8 }, { kupMonth: '2026-08' }])('never overwrites an existing record %j', async data => {
  properties(data);
  expect((await run()).saved).toBe(false);
  expect(api.requestJira.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});
test('blocks approved issues', async () => {
  properties(null, { status: 'approved' });
  expect((await run()).error).toContain('approved');
});
test('fails closed when property access is denied', async () => {
  api.requestJira.mockResolvedValueOnce({ status: 403 });
  expect((await run()).saved).toBe(false);
  expect(api.requestJira.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});
test('rejects reassignment', async () => {
  api.requestJira.mockReset().mockResolvedValueOnce(ok({ fields: { assignee: { accountId: 'other' } } }));
  expect((await run()).error).toContain('no longer assigned');
});
test('respects configured eligibility', async () => {
  kvs.get.mockResolvedValue({ enableAll: false, enabledProjects: ['9'] });
  expect((await run()).error).toContain('outside');
});
test('reports hours already saved when a later write fails', async () => {
  properties();
  api.requestJira.mockResolvedValueOnce(ok({})).mockResolvedValueOnce({ status: 500 });
  expect(await run()).toEqual({ saved: true, error: expect.stringContaining('Hours saved') });
});
