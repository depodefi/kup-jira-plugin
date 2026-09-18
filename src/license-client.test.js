import { invoke } from '@forge/bridge';
import { fetchLicenseStatus, LICENSE_MESSAGES } from './license-client.js';

jest.mock('@forge/bridge', () => ({ invoke: jest.fn() }));
beforeEach(() => jest.resetAllMocks());

it.each(['active', 'inactive', 'missing', 'error'])('preserves server status %s', async status => {
  invoke.mockResolvedValue({ status });
  await expect(fetchLicenseStatus()).resolves.toBe(status);
  expect(invoke).toHaveBeenCalledWith('getLicenseStatus');
});

it('recovers after a transport failure on retry without claiming expiration', async () => {
  invoke.mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce({ status: 'active' });
  await expect(fetchLicenseStatus()).resolves.toBe('error');
  expect(LICENSE_MESSAGES.error.title).toBe('Nie udało się sprawdzić licencji');
  await expect(fetchLicenseStatus()).resolves.toBe('active');
});

it.each([undefined, {}, { status: 'unexpected' }])('treats an invalid response as a technical error (%s)', async response => {
  invoke.mockResolvedValue(response);
  await expect(fetchLicenseStatus()).resolves.toBe('error');
});

it('distinguishes missing information from confirmed inactivity in the UI', () => {
  expect(LICENSE_MESSAGES.missing.title).toBe('Brak informacji o licencji');
  expect(LICENSE_MESSAGES.inactive.title).toBe('Licencja jest nieaktywna');
});
