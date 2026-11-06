/**
 * Peto Web model route: the account's device token authenticates pi-ai's OpenAI Responses client against the Peto
 * Agent gateway, and the gateway's `/models` listing supplies the catalog.
 *
 * ```yaml
 * - id: llm-peto-account
 *   name: '@deepseek-ai/dsh-llm-peto-account'
 *   config:
 *     baseURL: https://peto.example/api/agent/v1
 * ```
 *
 * @module @deepseek-ai/dsh-llm-peto-account
 */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-fs'
import { PiAiAdapter, authContextFrom, credentialStoreFrom, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions, PiAiModelProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { listingRequest, parseListing } from './listing.ts'

export { parseListing, reasoningEffortsOf } from './listing.ts'

export const name = 'llm-peto-account'
export const inject = ['llm']

/** Harness route key of the Peto gateway. */
export const PROVIDER = 'peto'

/** Gateway route configuration; authentication comes exclusively from the account service. */
export interface Config {
  /** Peto Agent gateway base URL; its origin must be the account service's server. */
  baseURL: string
  /** Route name shown by model selectors. */
  displayName?: string
  /** Deadline for one model-listing request. */
  modelsTimeoutMs?: number
  /** Listing age after which the next model lookup reloads it. */
  modelsMaxAgeMs?: number
  /** Wait after a failed listing before the next lookup tries again. */
  modelsRetryMs?: number
}
/** Validated deployment choices. */
export const Config = Schema.object({
  baseURL: Schema.string().required(),
  displayName: Schema.string().default('Peto'),
  modelsTimeoutMs: Schema.number().min(1).max(120_000).default(15_000),
  modelsMaxAgeMs: Schema.number().min(0).max(86_400_000).default(300_000),
  modelsRetryMs: Schema.number().min(0).max(3_600_000).default(10_000),
})

/**
 * Validate the gateway base URL.
 * @param value - configured base URL.
 * @returns the URL without a trailing slash; HTTPS, or HTTP on loopback for development.
 */
export function resolveBaseURL(value: string): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error('llm-peto-account: baseURL must be an HTTPS URL, or loopback HTTP, without credentials, query or fragment')
  }
  return url.href.replace(/\/+$/, '')
}

/** pi-ai's adapter whose catalog is loaded before every model lookup. */
class PetoAdapter extends PiAiAdapter {
  constructor(options: PiAiAdapterOptions, private readonly prepare: () => Promise<unknown>) { super(options) }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    await this.prepare()
    return super.listModels(provider)
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    await this.prepare()
    return super.resolveModel(provider, model, signal)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.prepare()
    const call = await super.prepareCall(provider, model, signal)
    return { ...call, stream: options => accountQuota(call.stream(options)) }
  }

  // A request sent before the first listing arrives would otherwise meet an empty catalog.
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.prepare()
    yield * accountQuota(super.stream(options))
  }
}

/**
 * Peto Web's `insufficient_quota` means the account's daily Peto Agent steps are used up: an account quota, which the
 * account feature explains with the reset time, as DeepSeek's account route does for its balance.
 * @param chunks - one streamed reply.
 * @returns the same chunks, with a provider quota failure recoded as the account quota.
 */
async function * accountQuota(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type !== 'finish' || chunk.reason.kind !== 'error' || chunk.reason.failure.code !== QUOTA_EXCEEDED_CODE) yield chunk
    else yield { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, code: ACCOUNT_QUOTA_EXCEEDED_CODE } } }
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  const baseURL = resolveBaseURL(resolved.baseURL)
  const build = (models: readonly PiAiModelProfile[]): ReadonlyMap<string, ResolvedPiAiProviderProfile> => resolveProfiles({
    [PROVIDER]: { displayName: resolved.displayName, api: 'openai-responses', baseURL, models: [...models] },
  }, 'deferred')
  /** The token the current catalog was listed with; undefined while signed out. */
  let listedFor: string | undefined
  let listedAt = 0
  let failed: { readonly token: string; readonly at: number } | undefined
  let profiles = build([])
  let loading: Promise<boolean> | undefined

  const token = async (): Promise<string | undefined> => ctx.get('deepseekAccount')?.resolveToken(baseURL)
  const resolveApiKey = async (): Promise<string> => {
    const current = await token()
    if (current === undefined) throw new LlmError('Sign in to Peto to use its models.', 'MISSING_CREDENTIAL')
    return current
  }

  /**
   * Bring the catalog in line with the current token: cleared when signed out, reloaded for a new token or a stale
   * listing. A failed reload keeps the previous listing of the same token.
   * @returns whether the offered catalog changed.
   */
  const prepare = (): Promise<boolean> => {
    loading ??= (async () => {
      const current = await token()
      if (current === undefined) {
        if (listedFor === undefined) return false
        listedFor = undefined
        profiles = build([])
        return true
      }
      const now = Date.now()
      if (current === listedFor && now - listedAt < resolved.modelsMaxAgeMs) return false
      if (failed?.token === current && now - failed.at < resolved.modelsRetryMs) return false
      const response = await fetch(`${baseURL}/models`, listingRequest(current, AbortSignal.timeout(resolved.modelsTimeoutMs)))
        .catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
      if (response instanceof Error || !response.ok) {
        failed = { token: current, at: now }
        if (!(response instanceof Error) && response.status === 401) {
          await ctx.get('deepseekAccount')?.rejectToken(current)
        }
        ctx.logger.warn('llm-peto-account: model listing failed (%s)', response instanceof Error ? response.name : `HTTP ${response.status}`)
        if (current === listedFor) return false
        // Another account's catalog must not stay offered under this token.
        const changed = listedFor !== undefined
        listedFor = undefined
        profiles = build([])
        return changed
      }
      const models = parseListing(await response.json().catch(() => undefined))
      if (models === undefined) {
        failed = { token: current, at: now }
        ctx.logger.warn('llm-peto-account: model listing response is not a valid listing')
        return false
      }
      failed = undefined
      listedFor = current
      listedAt = now
      profiles = build(models)
      return true
    })().finally(() => { loading = undefined })
    return loading
  }

  const adapter = new PetoAdapter({
    profiles: () => profiles,
    resolveApiKey,
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ model, reason }) => {
      ctx.logger.warn(`llm-peto-account: unusable replay state for "${model}"; sending provider-neutral content (${reason})`)
    },
  }, prepare)
  ctx.llm.registerAdapter([PROVIDER], adapter)
  /** Reload after a sign-in, sign-out or token change, then tell selectors to re-read the catalog. */
  const refresh = (): void => {
    void prepare().then((changed) => { if (changed) ctx.emit('llm/models-updated', PROVIDER) }, (error: unknown) => {
      ctx.logger.warn('llm-peto-account: model listing refresh failed')
      ctx.logger.warn(error)
    })
  }
  ctx.on('credentials/record-updated', refresh)
  ctx.on('deepseek-account/signed-out', refresh)
  refresh()
}
