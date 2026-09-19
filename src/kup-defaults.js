export const DEFAULT_WORKING_HOURS = {
  "2025-01":168,"2025-02":160,"2025-03":168,"2025-04":168,"2025-05":160,"2025-06":160,
  "2025-07":184,"2025-08":160,"2025-09":176,"2025-10":184,"2025-11":144,"2025-12":168,
  "2026-01":160,"2026-02":160,"2026-03":176,"2026-04":168,"2026-05":160,"2026-06":168,
  "2026-07":184,"2026-08":160,"2026-09":176,"2026-10":176,"2026-11":160,"2026-12":168,
  "2027-01":152,"2027-02":160,"2027-03":176,"2027-04":176,"2027-05":144,"2027-06":176,
  "2027-07":176,"2027-08":176,"2027-09":176,"2027-10":168,"2027-11":160,"2027-12":176,
  "2028-01":152,"2028-02":168,"2028-03":184,"2028-04":152,"2028-05":168,"2028-06":168,
  "2028-07":168,"2028-08":176,"2028-09":168,"2028-10":176,"2028-11":160,"2028-12":152,
  "2029-01":168,"2029-02":160,"2029-03":176,"2029-04":160,"2029-05":160,"2029-06":168,
  "2029-07":176,"2029-08":176,"2029-09":160,"2029-10":184,"2029-11":168,"2029-12":152,
  "2030-01":176,"2030-02":160,"2030-03":168,"2030-04":168,"2030-05":168,"2030-06":152,
  "2030-07":184,"2030-08":168,"2030-09":168,"2030-10":184,"2030-11":152,"2030-12":160,
};

/**
 * Calendar options for legacy report entry points.
 * The active UI uses independent year/month fields instead of this list.
 */
export function defaultAvailableMonths(year = new Date().getFullYear()) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

/** Resolve each month's baseline independently. Existing installations may still
 * have configuration keys ending in -KUP after the period picker update.
 * Preserve those overrides, prefer canonical keys, and fill missing months from
 * the bundled calendar. Never treat an explicit zero as a missing value. */
export function resolveWorkingHours(config) {
  const saved = config?.monthWorkingHours || {};
  const resolved = { ...DEFAULT_WORKING_HOURS };
  for (const [key, hours] of Object.entries(saved)) {
    if (/^\d{4}-(0[1-9]|1[0-2])-KUP$/.test(key)) {
      resolved[key.slice(0, -4)] = hours;
    }
  }
  for (const [key, hours] of Object.entries(saved)) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) resolved[key] = hours;
  }
  return resolved;
}

/** Return only genuine administrator overrides in the canonical YYYY-MM
 * format. Older installations may contain a full copy of the defaults or
 * keys ending in -KUP; neither should make the UI report false overrides. */
export function extractWorkingHoursOverrides(config) {
  const saved = config?.monthWorkingHours || {};
  const normalized = {};

  for (const [key, hours] of Object.entries(saved)) {
    if (/^\d{4}-(0[1-9]|1[0-2])-KUP$/.test(key)) {
      normalized[key.slice(0, -4)] = hours;
    }
  }
  for (const [key, hours] of Object.entries(saved)) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) normalized[key] = hours;
  }

  return Object.fromEntries(
    Object.entries(normalized).filter(([month, hours]) => DEFAULT_WORKING_HOURS[month] !== hours)
  );
}
