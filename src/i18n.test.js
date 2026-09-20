import english from '../locales/en-US.json';
import polish from '../locales/pl-PL.json';
import { supportedLocale, translate, translateError, formatNumber, formatDate } from './i18n.js';
import { LICENSE_MESSAGES } from './license-client.js';
import { initializeLocale, invoke, t, monthText } from './i18n-ui.js';
import { i18n as forgeI18n, invoke as forgeInvoke } from '@forge/bridge';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

jest.mock('@forge/bridge', () => ({
  i18n: { getTranslations: jest.fn() },
  invoke: jest.fn(),
}));

test.each([
  ['pl_PL', 'pl-PL'], ['pl-PL', 'pl-PL'], ['pl', 'pl-PL'], ['en_GB', 'en-US'],
  ['de-DE', 'en-US'], [undefined, 'en-US'],
])('normalizes Jira locale %s to %s', (input, expected) => {
  expect(supportedLocale(input)).toBe(expected);
});

test('both catalogs cover identical messages and preserve interpolation slots', () => {
  expect(Object.keys(polish).sort()).toEqual(Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    expect(polish[key].length).toBeGreaterThan(0);
    expect((polish[key].match(/\{\d+\}/g) || []).sort()).toEqual((english[key].match(/\{\d+\}/g) || []).sort());
  }
});

test('interpolates complete sentences without changing user content', () => {
  expect(translate('Approved issues: {0}. Employee: {1}.', [3, 'Approved'], 'pl-PL'))
    .toBe('Zatwierdzone zadania: 3. Pracownik: Approved.');
  expect(translate('Save KUP Data', [], 'de-DE')).toBe('Save KUP Data');
});

test('localizes existing resolver validation messages and hides unknown platform errors', () => {
  expect(translateError('Cannot approve — KUP is 60.5%, which exceeds the company limit of 50%.', 'pl-PL'))
    .toBe('Nie można zatwierdzić — udział KUP wynosi 60,5% i przekracza firmowy limit 50%.');
  expect(translateError('sensitive Jira payload', 'pl-PL')).toBe(polish['Unexpected error.']);
});

test('license status distinctions are available in both languages', () => {
  for (const status of ['inactive', 'missing', 'error']) {
    expect(english[LICENSE_MESSAGES[status].title]).toBeDefined();
    expect(polish[LICENSE_MESSAGES[status].text]).toBeDefined();
  }
  expect(translate(LICENSE_MESSAGES.missing.title, [], 'pl-PL')).toBe('Brak informacji o licencji');
});

test('formats visible numbers and dates for the selected language', () => {
  expect(formatNumber(12.5, 'pl-PL')).toBe('12,5');
  expect(formatNumber(12.5, 'en-US')).toBe('12.5');
  expect(formatNumber(null, 'pl-PL')).toBe('—');
  expect(formatDate('2026-09-19T12:00:00Z', 'pl-PL', false)).toMatch(/19.*2026/);
});

test('initializes Polish before use and translates only resolver message fields', async () => {
  forgeI18n.getTranslations.mockResolvedValue({ locale: 'pl-PL', translations: polish });
  await initializeLocale();
  expect(t('Save KUP Data')).toBe('Zapisz dane KUP');
  expect(monthText('2026-09')).toBe('wrzesień 2026');
  const result = { error: 'Unauthorized', status: 'pending', issues: [{ summary: 'Approved' }] };
  forgeInvoke.mockResolvedValue(result);
  expect(await invoke('example', { month: '2026-09' })).toEqual({ ...result, error: 'Brak uprawnień' });
  expect(result.error).toBe('Unauthorized');
  expect(forgeInvoke).toHaveBeenCalledWith('example', { month: '2026-09' });
});

test('falls back to English if Jira context cannot be read', async () => {
  forgeI18n.getTranslations.mockRejectedValue(new Error('offline'));
  await initializeLocale();
  expect(t('Save KUP Data')).toBe('Save KUP Data');
});

test('active views have catalog entries for static keys and no untranslated JSX prose', () => {
  const files = ['admin-ui/index.jsx', 'kup-panel-ui/index.jsx', 'kup-global-ui/index.jsx', 'allocate-hours.jsx', 'period-picker.jsx'];
  const problems = [];
  for (const file of files) {
    const ast = parse(fs.readFileSync(path.join(__dirname, file), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      CallExpression(p) {
        if (p.node.callee.name === 't' && p.node.arguments[0]?.type === 'StringLiteral') {
          if (!Object.hasOwn(english, p.node.arguments[0].value)) problems.push(p.node.arguments[0].value);
        }
      },
      JSXText(p) { if (/[A-Za-z]/.test(p.node.value)) problems.push(`${file}: ${p.node.value}`); },
    });
  }
  expect(problems).toEqual([]);
});
