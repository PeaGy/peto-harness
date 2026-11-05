/** Peto Agent gateway `/models` listing and its translation into pi-ai model profiles. */
import { z } from 'zod'
import type { PiAiModelProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'

const listing = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    display_name: z.string().min(1).optional(),
    context_window: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    /** Peto extension: the efforts the gateway accepts for this model, in Peto Web's spelling. */
    reasoning_efforts: z.array(z.string()).optional(),
  })),
})

/** Peto Web effort spellings by the pi-ai level that selects them; `none` is Peto's spelling of no reasoning. */
const LEVELS = {
  none: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
} as const satisfies Record<string, keyof PiAiReasoningEfforts>

/** Efforts every Peto model accepts; offered when a gateway predates the `reasoning_efforts` field. */
const BASELINE = ['low', 'medium', 'high'] as const

/**
 * Translate the gateway's efforts into selectable pi-ai levels with their wire spellings.
 * @param efforts - Peto Web effort names; undefined when the gateway omits them.
 * @returns the offered levels, or false when the model offers none beyond off.
 */
export function reasoningEffortsOf(efforts: readonly string[] | undefined): false | PiAiReasoningEfforts {
  const offered: PiAiReasoningEfforts = {}
  for (const effort of efforts ?? BASELINE) {
    if (Object.hasOwn(LEVELS, effort)) offered[LEVELS[effort as keyof typeof LEVELS]] = effort
  }
  return Object.keys(offered).some(level => level !== 'off') ? offered : false
}

/**
 * Validate one listing response.
 * @param body - parsed JSON body.
 * @returns model profiles in listing order, or undefined when the body is not a listing.
 */
export function parseListing(body: unknown): PiAiModelProfile[] | undefined {
  const parsed = listing.safeParse(body)
  if (!parsed.success) return undefined
  return parsed.data.data.map(model => ({
    id: model.id,
    name: model.display_name ?? model.id,
    // The gateway accepts text and data-URL images for every model.
    input: ['text', 'image'],
    reasoningEfforts: reasoningEffortsOf(model.reasoning_efforts),
    ...model.context_window === undefined ? {} : { contextWindow: model.context_window },
    ...model.max_output_tokens === undefined ? {} : { maxTokens: model.max_output_tokens },
  }))
}

/**
 * Build the listing request for one device token.
 * @param token - Peto Agent device token.
 * @param signal - listing deadline.
 * @returns fetch options; redirects fail so the token never follows one.
 */
export function listingRequest(token: string, signal: AbortSignal): RequestInit {
  return { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, redirect: 'error', signal }
}
