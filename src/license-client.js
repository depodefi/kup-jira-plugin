import { invoke } from '@forge/bridge';

export const LICENSE_MESSAGES = {
  inactive: {
    title: 'Licencja jest nieaktywna',
    text: 'Atlassian zgłasza nieaktywną licencję KUP 50% Compliance. Poproś administratora Jira o sprawdzenie subskrypcji aplikacji w Atlassian Marketplace.',
  },
  missing: {
    title: 'Brak informacji o licencji',
    text: 'Atlassian nie udostępnił informacji o licencji dla tej instalacji. Nie oznacza to, że subskrypcja wygasła. Poproś administratora Jira o sprawdzenie instalacji i subskrypcji aplikacji.',
  },
  error: {
    title: 'Nie udało się sprawdzić licencji',
    text: 'Wystąpił błąd weryfikacji licencji. Spróbuj ponownie. Ten komunikat nie oznacza wygaśnięcia subskrypcji.',
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
