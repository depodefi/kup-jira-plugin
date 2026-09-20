import { i18n, invoke as forgeInvoke } from '@forge/bridge';
import { supportedLocale, formatDate, formatNumber } from './i18n.js';

// Each resource runs in its own browser context. Initialize once before mounting
// the app, so loading messages, initial state and event handlers use one locale.
// This module is frontend-only: server invocations must never share user locale.
let locale = 'en-US';
let catalog = {};
export async function initializeLocale() {
  try {
    // Ask Forge for the parsed translation resource instead of importing the
    // JSON file into the UI bundle. Forge selects the resource using the
    // current user's Atlassian locale and applies manifest fallback rules.
    // This also avoids JSON-module interop differences in Forge's UI bundler.
    const translations = await i18n.getTranslations(null, { fallback: true });
    locale = supportedLocale(translations.locale);
    catalog = translations.translations || {};
  } catch {
    locale = 'en-US';
    catalog = {};
  }
}
export const getLocale = () => locale;
export const t = (key, values = []) => {
  const message = typeof catalog[key] === 'string' ? catalog[key] : key;
  return message.replace(/\{(\d+)\}/g, (match, index) =>
    values[index] == null ? match : String(values[index]));
};
export const errorText = message => {
  if (typeof message !== 'string') return t('Unexpected error.');
  if (typeof catalog[message] === 'string') return t(message);

  // Resolver messages can contain values inside a translated template. Match
  // the English key and insert the original values into the localized text.
  for (const key of Object.keys(catalog)) {
    if (!/\{\d+\}/.test(key)) continue;
    const escaped = key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = message.match(new RegExp(`^${escaped.join('(.+?)')}$`));
    if (match) return t(key, match.slice(1));
  }

  // A translated resolver error can pass through another catch unchanged.
  if (Object.values(catalog).includes(message)) return message;
  return t('Unexpected error.');
};
export const numberText = (value, digits) => formatNumber(value, locale, digits);
export const dateText = (value, includeTime) => formatDate(value, locale, includeTime);
export const monthText = period => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || '')) return period || '';
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${period}-01T12:00:00Z`));
};

export async function invoke(name, payload) {
  try {
    const result = await forgeInvoke(name, payload);
    if (result && !Array.isArray(result) && typeof result === 'object') {
      const translated = { ...result };
      for (const field of ['error', 'message', 'warning']) {
        if (typeof translated[field] === 'string') translated[field] = errorText(translated[field]);
      }
      return translated;
    }
    return result;
  } catch {
    throw new Error(t('Unexpected error.'));
  }
}
