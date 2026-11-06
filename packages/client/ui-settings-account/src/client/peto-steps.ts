/** Peto: pure helpers for the daily steps shown by the account card, the quota notice and onboarding. */
import type { AccountSteps } from '@deepseek-ai/dsh-deepseek-account/types'

/** Steps left at or below this share of the daily limit count as running low. */
export const LOW_SHARE = 0.1

/** How much of today's allowance is left. */
export type StepLevel = 'plenty' | 'low' | 'out'

/**
 * @param steps - today's steps.
 * @returns the steps still available, never negative.
 */
export function stepsLeft(steps: AccountSteps): number {
  return Math.max(0, steps.limit - steps.used)
}

/**
 * @param steps - today's steps.
 * @returns `out` with none left, `low` at or below {@link LOW_SHARE} of the limit, else `plenty`.
 */
export function stepLevel(steps: AccountSteps): StepLevel {
  const left = stepsLeft(steps)
  if (left === 0) return 'out'
  return left <= steps.limit * LOW_SHARE ? 'low' : 'plenty'
}

/**
 * Format the daily reset as a clock time in the viewer's zone. Only the time of day is shown: the count restarts at
 * the same moment every day, so a reset instant read yesterday still names the right time.
 * @param resetsAt - ISO instant from Peto Web, absent from older servers.
 * @param locale - formatting locale; undefined follows the system.
 * @returns the localized time with its zone, or undefined when unknown.
 */
export function formatResetTime(resetsAt: string | undefined, locale?: string): string | undefined {
  if (resetsAt === undefined) return undefined
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return undefined
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)
}

/**
 * @param tokens - token count.
 * @param locale - formatting locale; undefined follows the system.
 * @returns a compact count such as `1.2M`.
 */
export function formatTokens(tokens: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)
}
