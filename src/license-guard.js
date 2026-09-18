import { getAppContext } from '@forge/api';
import { logSafe } from './safe-logger.js';

/**
 * Only the server determines entitlement. A missing license is different from
 * an explicitly inactive license, and a runtime failure is neither of those.
 * Never return account identifiers or commercial license details to the UI.
 */
export function getLicenseStatus(backendRuntimePayload) {
  try {
    const context = getAppContext();
    const environment = context?.environmentType;
    if (!['PRODUCTION', 'DEVELOPMENT', 'STAGING'].includes(environment)) {
      return { status: 'error' };
    }
    // The resolver's second argument is supplied by Forge, not by the caller.
    // Prefer its entitlement when present, as the Forge resolver itself does.
    const license = backendRuntimePayload?.license ?? context.license;
    if (license?.active === true) return { status: 'active' };
    if (license?.active === false) return { status: 'inactive' };
    if (license == null && environment !== 'PRODUCTION') return { status: 'active' };
    return { status: license == null ? 'missing' : 'error' };
  } catch {
    return { status: 'error' };
  }
}

export function hasActiveLicense() {
  return getLicenseStatus().status === 'active';
}

/**
 * Expose a status-only operation even when paid operations are blocked. This
 * lets every UI display the server's decision instead of guessing from browser
 * context. Every other invocation still requires active entitlement.
 */
export function requireActiveLicense(handler) {
  return async (...args) => {
    const result = getLicenseStatus(args[1]);
    if (result.status !== 'active') {
      logSafe('warn', 'licenseCheck', { status: result.status });
    }
    if (args[0]?.call?.functionKey === 'getLicenseStatus') return result;
    if (result.status !== 'active') {
      return {
        success: false,
        licenseRequired: result.status === 'inactive' || result.status === 'missing',
        licenseStatus: result.status,
        error: result.status === 'inactive'
          ? 'An active KUP 50% Compliance subscription is required to use this app.'
          : 'Unable to verify the KUP 50% Compliance license. Please retry or contact your administrator.',
      };
    }
    return handler(...args);
  };
}
