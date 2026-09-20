import React from 'react';
import { Box, Inline, Label, Select } from '@forge/react';
import { getLocale, t } from './i18n-ui.js';
import { defaultKupPeriod, periodMonthOptions } from './kup-period.js';

/** Shared issue/report picker. Changing either field produces exactly one
 * YYYY-MM value; rendering the suggested period never writes to Jira. */
export function PeriodPicker({ id, value, onChange, isDisabled = false }) {
  const locale = getLocale();
  const [year, month] = (value?.value || defaultKupPeriod()).split('-');
  const currentYear = new Date().getFullYear();
  // Offer two correction years and one future year, in descending calendar order.
  // Always include the saved year so viewing an older issue preserves its value.
  const years = Array.from(new Set([
    ...[1, 0, -1, -2].map(offset => String(currentYear + offset)), year,
  ])).sort((a, b) => Number(b) - Number(a)).map(y => ({ label: y, value: y }));
  const months = periodMonthOptions(locale);
  const change = period => onChange({ label: period, value: period });
  return (
    <Inline space="space.100">
      <Box>
        <Label labelFor={`${id}-year`}>{t('Year')}</Label>
        <Select inputId={`${id}-year`} options={years} value={years.find(option => option.value === year)}
          onChange={option => option && change(`${option.value}-${month}`)} isDisabled={isDisabled} isClearable={false} />
      </Box>
      <Box>
        <Label labelFor={`${id}-month`}>{t('Month')}</Label>
        <Select inputId={`${id}-month`} options={months} value={months.find(option => option.value === month)}
          onChange={option => option && change(`${year}-${option.value}`)} isDisabled={isDisabled} isClearable={false} />
      </Box>
    </Inline>
  );
}
