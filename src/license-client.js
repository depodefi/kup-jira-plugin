import { invoke } from '@forge/bridge';

export const LICENSE_MESSAGES = {
  inactive: {
    title: 'License is inactive',
    text: 'Atlassian reports an inactive KUP 50% Compliance license. Ask your Jira administrator to check the app subscription in Atlassian Marketplace.',
  },
  missing: {
    title: 'License information unavailable',
    text: 'Atlassian did not provide license information for this installation. This does not mean the subscription has expired. Ask your Jira administrator to check the installation and subscription.',
  },
  error: {
    title: 'Unable to check the license',
    text: 'License verification failed. Try again. This message does not mean the subscription has expired.',
  },
};

// A transport failure or an unexpected response is a technical error, never an
// expired subscription. Keep this normalization shared by all three views.
export async function fetchLicenseStatus() {
  try {
    const result = await invoke('getLicenseStatus');
    return ['active', 'inactive', 'missing', 'error'].includes(result?.status)
      ? result.status
      : 'error';
  } catch {
    return 'error';
  }
}
