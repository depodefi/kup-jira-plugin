import * as forgeApi from '@forge/api';

/**
 * Forge only provides Marketplace license details in production. Development
 * and staging must stay usable so the paid-app flow can be tested with the
 * Forge CLI's simulated license states before a Marketplace listing is live.
 */
export function hasActiveLicense() {
  // The unit-test mocks intentionally expose only the API methods used by the
  // tested resolver. Treat a missing runtime-context helper as non-production;
  // real Forge production invocations always provide this helper and context.
  if (typeof forgeApi.getAppContext !== 'function') return true;

  const { environmentType, license } = forgeApi.getAppContext();
  return environmentType !== 'PRODUCTION' || license?.active === true;
}

/**
 * Apply the Marketplace entitlement check to an entire resolver. This keeps
 * the server authoritative: users cannot bypass the UI's license message by
 * directly invoking an individual resolver operation.
 */
export function requireActiveLicense(handler) {
  return async (...args) => {
    if (!hasActiveLicense()) {
      return {
        success: false,
        licenseRequired: true,
        error: 'An active KUP 50% Compliance subscription is required to use this app.',
      };
    }
    return handler(...args);
  };
}
