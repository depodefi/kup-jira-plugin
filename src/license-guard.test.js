import { getAppContext } from '@forge/api';
import { getLicenseStatus, hasActiveLicense, requireActiveLicense } from './license-guard.js';

jest.mock('@forge/api', () => ({ getAppContext: jest.fn() }));
jest.mock('./safe-logger.js', () => ({ logSafe: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

describe('server license classification', () => {
  it.each([
    ['active production', { environmentType: 'PRODUCTION', license: { active: true } }, 'active'],
    ['inactive production', { environmentType: 'PRODUCTION', license: { active: false } }, 'inactive'],
    ['missing production license', { environmentType: 'PRODUCTION' }, 'missing'],
    ['malformed license', { environmentType: 'PRODUCTION', license: {} }, 'error'],
    ['development', { environmentType: 'DEVELOPMENT' }, 'active'],
    ['staging', { environmentType: 'STAGING' }, 'active'],
    ['simulated inactive license', { environmentType: 'DEVELOPMENT', license: { active: false } }, 'inactive'],
    ['unknown environment', {}, 'error'],
  ])('classifies %s', (_label, context, status) => {
    getAppContext.mockReturnValue(context);
    expect(getLicenseStatus()).toEqual({ status });
    expect(hasActiveLicense()).toBe(status === 'active');
  });

  it('reports a runtime error without claiming that the license expired', () => {
    getAppContext.mockImplementation(() => { throw new Error('Runtime unavailable'); });
    expect(getLicenseStatus()).toEqual({ status: 'error' });
    expect(hasActiveLicense()).toBe(false);
  });

  it('uses the Forge-supplied resolver entitlement when runtime context omits it', async () => {
    getAppContext.mockReturnValue({ environmentType: 'PRODUCTION' });
    const handler = jest.fn().mockResolvedValue({ success: true });
    const request = { call: { functionKey: 'saveKupData' } };
    const runtime = { license: { active: true } };
    await expect(requireActiveLicense(handler)(request, runtime)).resolves.toEqual({ success: true });
    expect(handler).toHaveBeenCalledWith(request, runtime);
  });
});

describe('resolver access', () => {
  it.each([
    [{ active: false }, 'inactive'],
    [undefined, 'missing'],
    [{}, 'error'],
  ])('returns status without granting paid access (%s)', async (license, status) => {
    getAppContext.mockReturnValue({ environmentType: 'PRODUCTION', license });
    const handler = jest.fn();
    const guarded = requireActiveLicense(handler);
    await expect(guarded({ call: { functionKey: 'getLicenseStatus' } })).resolves.toEqual({ status });
    // A user-controlled payload cannot assert its own entitlement.
    await expect(guarded({ call: { functionKey: 'saveKupData', payload: { license: { active: true } } } }))
      .resolves.toMatchObject({ success: false, licenseStatus: status });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not leak commercial license details through the public status operation', async () => {
    getAppContext.mockReturnValue({
      environmentType: 'PRODUCTION',
      license: { active: true, ccpEntitlementId: 'private-value' },
    });
    const handler = jest.fn();
    await expect(requireActiveLicense(handler)({ call: { functionKey: 'getLicenseStatus' } }))
      .resolves.toEqual({ status: 'active' });
    expect(handler).not.toHaveBeenCalled();
  });
});
