/**
 * Compact coin / big-number display: 19159 → "19.2k", 1_500_000 → "1.5m".
 * Under 1000 stays exact so small prices stay readable.
 */
export function formatCoins(value: number): string {
  const n = Math.floor(Math.abs(value))
  const sign = value < 0 ? '-' : ''
  if (n < 1000) return sign + String(n)

  const units: { div: number; suffix: string }[] = [
    { div: 1e12, suffix: 't' },
    { div: 1e9, suffix: 'b' },
    { div: 1e6, suffix: 'm' },
    { div: 1e3, suffix: 'k' },
  ]

  for (const { div, suffix } of units) {
    if (n >= div) {
      const scaled = n / div
      const text =
        scaled >= 100
          ? String(Math.round(scaled))
          : String(Math.round(scaled * 10) / 10)
      return sign + text + suffix
    }
  }
  return sign + String(n)
}
