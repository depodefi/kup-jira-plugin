import { extractWorkingHoursOverrides, resolveWorkingHours } from './kup-defaults.js';

describe('working-hour baselines after period format changes', () => {
  it('fills a missing September baseline even when other months are configured', () => {
    expect(resolveWorkingHours({ monthWorkingHours: { '2026-08': 120 } })['2026-09']).toBe(176);
  });
  it('preserves an old-format custom baseline', () => {
    expect(resolveWorkingHours({ monthWorkingHours: { '2026-09-KUP': 150 } })['2026-09']).toBe(150);
  });
  it('prefers a canonical override, including zero, over the old value', () => {
    const config = { monthWorkingHours: { '2026-09': 0, '2026-09-KUP': 150 } };
    const result = resolveWorkingHours(config);
    expect(result['2026-09']).toBe(0);
    expect(result['2026-09-KUP']).toBeUndefined();
    expect(config.monthWorkingHours['2026-09-KUP']).toBe(150);
  });
  it('uses the calendar for a fresh installation', () => {
    expect(resolveWorkingHours(null)['2026-09']).toBe(176);
  });
});

describe('working-hour overrides shown in admin settings', () => {
  it('removes copied defaults and keeps custom values only', () => {
    const config = { monthWorkingHours: { '2026-08': 160, '2026-09': 150 } };
    expect(extractWorkingHoursOverrides(config)).toEqual({ '2026-09': 150 });
  });

  it('normalizes legacy keys and lets canonical values win', () => {
    const config = { monthWorkingHours: { '2026-09-KUP': 150, '2026-09': 140 } };
    expect(extractWorkingHoursOverrides(config)).toEqual({ '2026-09': 140 });
  });
});
