import * as forgeApi from '@forge/api';
import { hasActiveLicense, requireActiveLicense } from './license-guard.js';

jest.mock('@forge/api', () => ({
  getAppContext: jest.fn(),
}));

describe('license guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks resolver access when a production subscription is inactive', async () => {
    forgeApi.getAppContext.mockReturnValue({
      environmentType: 'PRODUCTION',
      license: { active: false },
    });

    const handler = jest.fn();
    const guardedHandler = requireActiveLicense(handler);

    await expect(guardedHandler()).resolves.toEqual({
      success: false,
      licenseRequired: true,
      error: 'An active KUP 50% Compliance subscription is required to use this app.',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows active production subscriptions', async () => {
    forgeApi.getAppContext.mockReturnValue({
      environmentType: 'PRODUCTION',
      license: { active: true },
    });

    const handler = jest.fn().mockResolvedValue({ success: true });

    await expect(requireActiveLicense(handler)('value')).resolves.toEqual({ success: true });
    expect(handler).toHaveBeenCalledWith('value');
  });

  it('allows non-production environments for paid-app testing', () => {
    forgeApi.getAppContext.mockReturnValue({ environmentType: 'DEVELOPMENT' });

    expect(hasActiveLicense()).toBe(true);
  });
});
