/** A period is locale-independent in Jira properties, JQL, exports and storage. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Use the user's calendar date. Construct day 1 before moving backwards so
 * dates near the end of a month cannot overflow into the following month. */
export function defaultKupPeriod(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), 1);
  if (now.getDate() <= 10) date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function initialKupPeriod(savedPeriod, now = new Date()) {
  return PERIOD_PATTERN.test(savedPeriod || '') ? savedPeriod : defaultKupPeriod(now);
}

export function periodMonthOptions(locale = 'en') {
  return Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: new Intl.DateTimeFormat(locale.replace('_', '-'), { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2026, index, 1))),
  }));
}
