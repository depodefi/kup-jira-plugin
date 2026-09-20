import english from '../locales/en-US.json';
import polish from '../locales/pl-PL.json';

export function supportedLocale(locale) {
  return /^pl(?:[-_]|$)/i.test(locale || '') ? 'pl-PL' : 'en-US';
}

// Plain dictionaries keep text outside components. Placeholders represent
// complete phrases, avoiding English plural suffixes or sentence fragments.
export function translate(key, values = [], locale = 'en-US') {
  const catalog = supportedLocale(locale) === 'pl-PL' ? polish : english;
  const message = catalog[key] ?? english[key] ?? key;
  return message.replace(/\{(\d+)\}/g, (match, index) => values[index] == null ? match : String(values[index]));
}

// Existing resolvers return English messages. Translate only their message
// fields at the UI boundary, never issue summaries, user names or status IDs.
// Unknown platform errors get a localized fallback rather than leaking raw
// technical output. Template matching also supports existing numeric errors.
export function translateError(message, locale = 'en-US') {
  if (typeof message !== 'string') return translate('Unexpected error.', [], locale);
  if (Object.hasOwn(english, message)) return translate(message, [], locale);
  for (const key of Object.keys(english)) {
    if (!/\{\d+\}/.test(key)) continue;
    const escaped = key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = message.match(new RegExp(`^${escaped.join('(.+?)')}$`));
    if (match) {
      const values = match.slice(1).map(value =>
        /hours|%/i.test(key) && /^\d+(\.\d+)?$/.test(value) ? formatNumber(value, locale) : value);
      return translate(key, values, locale);
    }
  }
  // Already localized messages may pass through a catch after an invocation.
  if (Object.values(polish).includes(message)) return message;
  return translate('Unexpected error.', [], locale);
}

export function formatNumber(value, locale = 'en-US', digits = 2) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return value ?? '—';
  return new Intl.NumberFormat(supportedLocale(locale), { maximumFractionDigits: digits }).format(Number(value));
}

export function formatDate(value, locale = 'en-US', includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(supportedLocale(locale), {
    dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}
