import { managerHandler } from './manager-resolvers';
import api, { storage } from '@forge/api';

jest.mock('@forge/api', () => {
  return {
    route: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
    storage: {
      get: jest.fn(),
      set: jest.fn(),
    },
    asApp: jest.fn().mockReturnThis(),
    requestJira: jest.fn(),
  };
});

// Helper to invoke a resolver function via the handler.
// The Forge Resolver reads payload from call.payload and accountId from
// backendRuntimePayload.principal.accountId (second argument).
function invoke(functionKey, payload = {}, accountId = 'manager-001') {
  return managerHandler(
    {
      context: {},
      contextToken: 'token',
      call: { functionKey, payload },
    },
    { principal: { accountId } }
  );
}

// Config where manager-001 is a manager
const managerConfig = { managerUsers: ['manager-001'], managerGroups: [] };

describe('managerResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Authorization ---

  it('getManagerReport returns Unauthorized for non-managers', async () => {
    storage.get.mockResolvedValueOnce({ managerUsers: [], managerGroups: [] });

    const result = await invoke('getManagerReport', { month: '2026-03-KUP' }, 'dev-001');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('bulkApprove returns Unauthorized for non-managers', async () => {
    storage.get.mockResolvedValueOnce({ managerUsers: [], managerGroups: [] });

    const result = await invoke('bulkApprove', { accountId: 'dev-001', month: '2026-03-KUP' }, 'dev-002');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('bulkUnapprove returns Unauthorized for non-managers', async () => {
    storage.get.mockResolvedValueOnce({ managerUsers: [], managerGroups: [] });

    const result = await invoke('bulkUnapprove', { accountId: 'dev-001', month: '2026-03-KUP' }, 'dev-002');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  // --- getManagerReport ---

  it('getManagerReport groups issues by assignee with correct totals and status', async () => {
    // storage.get calls: checkIsManager, teamFilter (skipped), final config for maxWorkingHours
    storage.get
      .mockResolvedValueOnce(managerConfig)      // checkIsManager
      .mockResolvedValueOnce({ monthWorkingHours: { '2026-03-KUP': 176 } }); // maxWorkingHours

    api.requestJira.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 3,
        issues: [
          {
            key: 'PROJ-1',
            fields: { summary: 'Task A', assignee: { accountId: 'dev-001', displayName: 'Alice' } },
            properties: { 'kup-data': { kupHours: 8 }, 'kup-approval': { status: 'approved' } },
          },
          {
            key: 'PROJ-2',
            fields: { summary: 'Task B', assignee: { accountId: 'dev-001', displayName: 'Alice' } },
            properties: { 'kup-data': { kupHours: 4 }, 'kup-approval': { status: 'pending' } },
          },
          {
            key: 'PROJ-3',
            fields: { summary: 'Task C', assignee: { accountId: 'dev-002', displayName: 'Bob' } },
            properties: { 'kup-data': { kupHours: 16 }, 'kup-approval': { status: 'approved' } },
          },
        ],
      }),
    });

    const result = await invoke('getManagerReport', { month: '2026-03-KUP' });

    expect(result.month).toBe('2026-03-KUP');
    expect(result.maxWorkingHours).toBe(176);
    expect(result.users).toHaveLength(2);

    const alice = result.users.find(u => u.accountId === 'dev-001');
    expect(alice.displayName).toBe('Alice');
    expect(alice.totalHours).toBe(12);
    expect(alice.issueCount).toBe(2);
    expect(alice.status).toBe('mixed');

    const bob = result.users.find(u => u.accountId === 'dev-002');
    expect(bob.totalHours).toBe(16);
    expect(bob.issueCount).toBe(1);
    expect(bob.status).toBe('approved');
  });

  it('getManagerReport status is "pending" when all issues are pending', async () => {
    storage.get
      .mockResolvedValueOnce(managerConfig)
      .mockResolvedValueOnce({});

    api.requestJira.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 2,
        issues: [
          {
            key: 'PROJ-1',
            fields: { summary: 'Task A', assignee: { accountId: 'dev-001', displayName: 'Alice' } },
            properties: { 'kup-data': { kupHours: 5 }, 'kup-approval': { status: 'pending' } },
          },
          {
            key: 'PROJ-2',
            fields: { summary: 'Task B', assignee: { accountId: 'dev-001', displayName: 'Alice' } },
            properties: { 'kup-data': { kupHours: 3 }, 'kup-approval': { status: 'pending' } },
          },
        ],
      }),
    });

    const result = await invoke('getManagerReport', { month: '2026-03-KUP' });
    const alice = result.users.find(u => u.accountId === 'dev-001');
    expect(alice.status).toBe('pending');
    expect(alice.totalHours).toBe(8);
  });

  it('getManagerReport filters by statusFilter in JQL', async () => {
    storage.get
      .mockResolvedValueOnce(managerConfig)
      .mockResolvedValueOnce({});

    api.requestJira.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, issues: [] }),
    });

    await invoke('getManagerReport', { month: '2026-03-KUP', statusFilter: 'pending' });

    const [, callArgs] = api.requestJira.mock.calls[0];
    const body = JSON.parse(callArgs.body);
    expect(body.jql).toContain("issue.property[kup-approval].status = \"pending\"");
  });

  // --- bulkApprove ---

  it('bulkApprove writes approved status and audit entry for each pending issue', async () => {
    // checkIsManager
    storage.get.mockResolvedValueOnce(managerConfig);

    // Fetch manager display name
    api.requestJira
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Manager Mike' }) })
      // JQL search for target user's issues
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 2,
          issues: [
            { key: 'PROJ-10', fields: { summary: 'X' }, properties: { 'kup-approval': { status: 'pending' } } },
            { key: 'PROJ-11', fields: { summary: 'Y' }, properties: { 'kup-approval': {} } },
          ],
        }),
      })
      // PROJ-10: PUT kup-approval, GET kup-audit-log (404), PUT kup-audit-log
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })   // PUT approval PROJ-10
      .mockResolvedValueOnce({ ok: false })                          // GET audit log PROJ-10 (not found)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })   // PUT audit log PROJ-10
      // PROJ-11: same sequence
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })   // PUT approval PROJ-11
      .mockResolvedValueOnce({ ok: false })                          // GET audit log PROJ-11
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });  // PUT audit log PROJ-11

    const result = await invoke('bulkApprove', { accountId: 'dev-001', month: '2026-03-KUP' });

    expect(result).toEqual({ success: true, approvedCount: 2 });

    // Verify the approval write for PROJ-10
    const approvalCall = api.requestJira.mock.calls.find(
      ([url, opts]) => url.includes('PROJ-10/properties/kup-approval') && opts.method === 'PUT'
    );
    expect(approvalCall).toBeTruthy();
    const body = JSON.parse(approvalCall[1].body);
    expect(body.status).toBe('approved');
    expect(body.approvedBy).toBe('manager-001');
    expect(body.approvedByName).toBe('Manager Mike');
    expect(body.approvedAt).toBeDefined();

    // Verify audit log was written for PROJ-10
    const auditCall = api.requestJira.mock.calls.find(
      ([url, opts]) => url.includes('PROJ-10/properties/kup-audit-log') && opts?.method === 'PUT'
    );
    expect(auditCall).toBeTruthy();
    const auditBody = JSON.parse(auditCall[1].body);
    expect(auditBody[0].action).toBe('approval');
    expect(auditBody[0].changes.status).toEqual({ from: 'pending', to: 'approved' });
  });

  it('bulkApprove skips already-approved issues', async () => {
    storage.get.mockResolvedValueOnce(managerConfig);

    api.requestJira
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Manager Mike' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          issues: [
            { key: 'PROJ-20', fields: { summary: 'Z' }, properties: { 'kup-approval': { status: 'approved' } } },
          ],
        }),
      });

    const result = await invoke('bulkApprove', { accountId: 'dev-001', month: '2026-03-KUP' });
    expect(result).toEqual({ success: true, approvedCount: 0 });
    // Only 2 requestJira calls: user fetch + JQL search (no writes)
    expect(api.requestJira).toHaveBeenCalledTimes(2);
  });

  // --- bulkUnapprove ---

  it('bulkUnapprove resets approved issues to pending and writes audit entry', async () => {
    storage.get.mockResolvedValueOnce(managerConfig);

    api.requestJira
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Manager Mike' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          issues: [
            { key: 'PROJ-30', fields: { summary: 'W' }, properties: { 'kup-approval': { status: 'approved' } } },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })  // PUT approval
      .mockResolvedValueOnce({ ok: false })                         // GET audit log
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // PUT audit log

    const result = await invoke('bulkUnapprove', { accountId: 'dev-001', month: '2026-03-KUP' });
    expect(result).toEqual({ success: true, unapprovedCount: 1 });

    const approvalCall = api.requestJira.mock.calls.find(
      ([url, opts]) => url.includes('PROJ-30/properties/kup-approval') && opts.method === 'PUT'
    );
    const body = JSON.parse(approvalCall[1].body);
    expect(body.status).toBe('pending');
    expect(body.approvedBy).toBeNull();
    expect(body.approvedByName).toBeNull();
    expect(body.approvedAt).toBeNull();

    const auditCall = api.requestJira.mock.calls.find(
      ([url, opts]) => url.includes('PROJ-30/properties/kup-audit-log') && opts?.method === 'PUT'
    );
    const auditBody = JSON.parse(auditCall[1].body);
    expect(auditBody[0].action).toBe('unapproval');
    expect(auditBody[0].changes.status).toEqual({ from: 'approved', to: 'pending' });
  });

  it('bulkUnapprove skips non-approved issues', async () => {
    storage.get.mockResolvedValueOnce(managerConfig);

    api.requestJira
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Manager Mike' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          issues: [
            { key: 'PROJ-31', fields: { summary: 'V' }, properties: { 'kup-approval': { status: 'pending' } } },
          ],
        }),
      });

    const result = await invoke('bulkUnapprove', { accountId: 'dev-001', month: '2026-03-KUP' });
    expect(result).toEqual({ success: true, unapprovedCount: 0 });
    expect(api.requestJira).toHaveBeenCalledTimes(2);
  });
});
