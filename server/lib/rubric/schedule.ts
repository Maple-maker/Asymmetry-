// lib/rubric/schedule.ts
//
// Ported VERBATIM from MarketPulse `lib/spcx/schedule.ts`. No imports, no changes.
// Drives the biweekly DCA cadence: true on the anchor day and every 14 days after it.

/**
 * Is `todayISO` a biweekly DCA day relative to `anchorISO`?
 * Both args are `YYYY-MM-DD`. Computed in UTC to avoid timezone drift.
 * True only on/after the anchor, on a 14-day multiple.
 */
export function isBiweeklyDcaDay(anchorISO: string, todayISO: string): boolean {
  const anchor = new Date(anchorISO + "T00:00:00Z").getTime();
  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const days = Math.round((today - anchor) / (24 * 3600 * 1000));
  return days >= 0 && days % 14 === 0;
}
