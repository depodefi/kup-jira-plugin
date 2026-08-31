import { logSafe, safeErrorCode } from './safe-logger';

describe('safe logger', () => {
  let originalInfo;

  beforeEach(() => {
    originalInfo = console.info;
    console.info = jest.fn();
  });

  afterEach(() => {
    console.info = originalInfo;
  });

  it('keeps operational fields and strips identity and content fields', () => {
    logSafe('info', 'getManagerReport', {
      requestId: 'request-123',
      month: '2026-03-KUP',
      pagesFetched: 3,
      accountId: 'user-123',
      issueKey: 'PROJ-123',
      displayName: 'Alice Example',
      responseBody: 'private Jira response',
      status: 'success',
    });

    const line = console.info.mock.calls[0][0];
    expect(line).toContain('request-123');
    expect(line).toContain('pagesFetched');
    expect(line).not.toContain('user-123');
    expect(line).not.toContain('PROJ-123');
    expect(line).not.toContain('Alice Example');
    expect(line).not.toContain('private Jira response');
  });

  it('returns a safe error code without exposing an exception message', () => {
    expect(safeErrorCode(new Error('contains private response text'))).toBe('Error');
    expect(safeErrorCode({ code: 'ETIMEDOUT', message: 'private details' })).toBe('ETIMEDOUT');
  });
});
