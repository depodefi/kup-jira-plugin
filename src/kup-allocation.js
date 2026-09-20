// Work in hundredths of an hour so rounding never changes the declared total.
export function hourUnits(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const units = Math.round(Number(value) * 100);
  return Number.isSafeInteger(units) && units > 0 && units <= 74400 ? units : null;
}

export function splitHours(total, count) {
  const units = hourUnits(total);
  if (!units || !Number.isInteger(count) || count < 1 || units < count) return null;
  return Array.from({ length: count }, (_, index) =>
    (Math.floor(units / count) + (index < units % count ? 1 : 0)) / 100);
}
