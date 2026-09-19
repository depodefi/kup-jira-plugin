import { defaultKupPeriod, initialKupPeriod, periodMonthOptions, PERIOD_PATTERN } from './kup-period.js';

describe('KUP period defaults', () => {
  test.each([
    [new Date(2026, 8, 1), '2026-08'],
    [new Date(2026, 8, 10, 23, 59), '2026-08'],
    [new Date(2026, 8, 11), '2026-09'],
    [new Date(2026, 8, 30), '2026-09'],
    [new Date(2026, 0, 10), '2025-12'],
    [new Date(2026, 0, 11), '2026-01'],
    [new Date(2024, 2, 10), '2024-02'],
  ])('%s suggests %s', (date, expected) => {
    expect(defaultKupPeriod(date)).toBe(expected);
  });

  it('preserves a previously saved period across the cutoff', () => {
    expect(initialKupPeriod('2025-04', new Date(2026, 8, 11))).toBe('2025-04');
    expect(initialKupPeriod(null, new Date(2026, 8, 10))).toBe('2026-08');
  });

  it('localizes labels while preserving month values', () => {
    const pl = periodMonthOptions('pl_PL');
    const en = periodMonthOptions('en-US');
    expect(pl[8]).toEqual({ label: 'wrzesień', value: '09' });
    expect(en[8]).toEqual({ label: 'September', value: '09' });
    expect(pl.map(option => option.value)).toEqual(en.map(option => option.value));
  });

  test.each(['2026-00', '2026-13', '2026-9', '2026-09-KUP', 'September 2026'])('rejects invalid period %s', value => {
    expect(PERIOD_PATTERN.test(value)).toBe(false);
  });
});
