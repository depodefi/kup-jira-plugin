import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLicenseStatus, LICENSE_MESSAGES } from './license-client.js';
import { t } from './i18n-ui.js';

export function useLicenseStatus() {
  const [status, setStatus] = useState('loading');
  const request = useRef(0);
  const checkLicense = useCallback(async () => {
    const current = ++request.current;
    setStatus('loading');
    const next = await fetchLicenseStatus();
    // Ignore an older response after a retry or an unmounted view.
    if (current === request.current) setStatus(next);
  }, []);

  useEffect(() => {
    checkLicense();
    return () => { request.current++; };
  }, [checkLicense]);

  const message = LICENSE_MESSAGES[status] || LICENSE_MESSAGES.error;
  return {
    licenseActive: status === 'loading' ? null : status === 'active',
    licenseMessage: { title: t(message.title), text: t(message.text) },
    checkLicense,
  };
}
