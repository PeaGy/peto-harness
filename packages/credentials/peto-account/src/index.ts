/** Peto Web device-code provider of the shared account Service Definition; browser approval never bypasses local cancellation. */
import { randomUUID } from 'node:crypto'
import { hostname, platform, release } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import {
  DeepSeekAccount, installAccountTaskCancellation, type AccountBonusBatch, type AccountDetails, type AccountUserId, type AccountView,
  type AccountBonusOrderId, type AccountClientMetadata, type AccountSteps, type PlatformSession, type SignInAttemptId,
  type SignInAttemptView,
} from '@deepseek-ai/dsh-deepseek-account'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { PetoAuthError, PetoDeniedError, me, pollDevice, requestPeto, serverOrigin, started, usage, verificationUrl } from './protocol.ts'
import type { DevicePoll, PetoResponse } from './protocol.ts'

export { PetoAuthError, PetoDeniedError, serverOrigin, verificationUrl } from './protocol.ts'

/** Record holding the device token; its payload is written only in this plugin's format. */
export const KEY = credentialKey('peto-account', 'default')
const grant = z.object({
  version: z.literal(1),
  server: z.url(),
  token: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string(),
  account: z.string(),
})
type Grant = z.infer<typeof grant>
type ReadyProfile = Extract<AccountDetails['profile'], { status: 'ready' }>
/** Outcome of one `/api/agent/me` read; `stale` means the credential changed or expired meanwhile. */
type MeRead = { readonly kind: 'ok'; readonly body: unknown } | { readonly kind: 'failed' } | { readonly kind: 'stale' }

/** Consecutive transient poll failures tolerated before an attempt fails; one more ends it. */
const POLL_FAILURES = 3
const ACTIVE_PHASES: ReadonlySet<SignInAttemptView['phase']> = new Set(['initializing', 'waiting-browser', 'exchanging', 'committing'])

/** Deployment choices for the Peto Web account. */
export interface Config {
  /** Peto Web origin serving the Agent device flow and the model gateway. */
  server: string
  /** Name Peto Web lists for this device; empty uses this machine's host name. */
  deviceName?: string
  /** Allow HTTP only on loopback for a local Peto Web development server. */
  allowLoopbackHttp?: boolean
  /** Deadline for each Peto Web HTTP request. */
  requestTimeoutMs?: number
  /** Upper bound for one sign-in attempt, even if Peto Web advertises a longer code lifetime. */
  attemptTimeoutMs?: number
}
/** Validated deployment choices. */
export const Config = Schema.object({
  server: Schema.string().required(),
  deviceName: Schema.string().default(''),
  allowLoopbackHttp: Schema.boolean().default(false),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  attemptTimeoutMs: Schema.number().min(1).max(3_600_000).default(600_000),
})

/**
 * Resolve the device label sent with each new device code.
 * @param configured - configured label; empty selects the host name.
 * @returns a non-empty label; Peto Web trims it to 60 characters.
 */
export function resolveDeviceName(configured: string): string {
  return configured.trim() || hostname() || 'Peto Harness'
}

interface Attempt {
  view: SignInAttemptView
  controller: AbortController
  done: Promise<void>
  running: Promise<void>
}

/** The Peto implementation owns login state and its opaque stored device token. */
export class PetoAccount extends DeepSeekAccount {
  static inject = ['credentials', 'authorization']
  static Config = Config
  private readonly origin: string
  private readonly deviceName: string
  private readonly requestTimeout: number
  private readonly attemptTimeout: number
  private readonly logoutLifetime = new AbortController()
  private readonly revocations = new Set<Promise<void>>()
  private attempt: Attempt | undefined
  private readonly listeners = new Set<(identityOnly: boolean) => void>()
  /** Latest ready profile and the token it was read with, so a cached name never answers for a newer credential. */
  private lastProfile: { readonly token: string; readonly profile: ReadyProfile } | undefined
  /** The `/api/agent/me` read the profile and balance queries of one refresh share. */
  private meRead: { readonly token: string; readonly lifetime: AbortController; readonly result: Promise<MeRead> } | undefined
  private detailsLifetime = new AbortController()
  private closed = false
  private removing: Promise<AccountView> | undefined

  /** @param ctx - Host with authorization and credentials services. @param config - deployment options. */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    installAccountTaskCancellation(ctx)
    const resolved = Config(config)
    this.origin = serverOrigin(resolved.server, resolved.allowLoopbackHttp)
    this.deviceName = resolveDeviceName(resolved.deviceName)
    this.requestTimeout = resolved.requestTimeoutMs
    this.attemptTimeout = resolved.attemptTimeoutMs
    ctx.authorization.registerFlow({
      key: KEY, label: 'Peto', methods: [{ id: 'browser', label: 'Peto' }],
      run: (session) => {
        const attempt = this.attempt
        if (attempt === undefined) return Promise.reject(new PetoAuthError('protocol'))
        attempt.running = this.run(session, attempt)
        return attempt.running
      },
    })
    ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY) return
      this.invalidateDetails()
      this.changed()
    })
    ctx.effect(() => async () => {
      this.closed = true
      this.logoutLifetime.abort()
      this.invalidateDetails()
      const active = this.attempt
      if (active !== undefined) {
        if (active.view.phase !== 'committing') active.controller.abort()
        await active.done
      }
      await this.removing
      await Promise.all(this.revocations)
      this.changed()
    }, 'peto-account: active attempt lifetime')
  }

  async [Service.init](): Promise<void> {
    const stored = await this.readGrant()
    // A token issued by another Peto server must never reach this one.
    if (stored !== undefined && stored.server !== this.origin) await this.ctx.credentials.deleteRecord(KEY)
  }

  override async getState(): Promise<AccountView> {
    const stored = await this.readGrant()
    const attempt = this.attempt?.view ?? null
    const home = new URL('/', this.origin).href
    return {
      status: stored === undefined ? 'signed-out' : 'credential-stored',
      // Credential removal can notify watchers before sign-out finishes clearing the attempt.
      attempt: stored === undefined && attempt?.phase === 'succeeded' ? null : attempt,
      // Peto Web keeps usage and devices in Settings → Peto Agent, which `?settings=agent` opens.
      links: { usageUrl: home, topUpUrl: home, manageUrl: new URL('/?settings=agent', this.origin).href },
    }
  }

  override async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const lifetime = this.detailsLifetime
    const stored = await this.readCurrentGrant(lifetime)
    if (stored === null) return null
    const fallback = this.lastProfile?.token === stored.token ? this.lastProfile.profile : profileOf(stored, stored.account)
    const read = await this.readMe(stored, lifetime)
    if (read.kind === 'stale') return null
    // Timeouts, lost connections and unexpected answers keep the name read at sign-in.
    const body = read.kind === 'ok' ? me.safeParse(read.body) : undefined
    if (body?.success !== true) return fallback
    const profile = profileOf(stored, body.data.account)
    this.lastProfile = { token: stored.token, profile }
    return profile
  }

  override async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    // Peto Web meters daily Agent steps instead of a wallet: a signed-in account has no wallets, only steps.
    const lifetime = this.detailsLifetime
    const stored = await this.readCurrentGrant(lifetime)
    if (stored === null) return null
    const read = await this.readMe(stored, lifetime)
    if (read.kind === 'stale') return null
    const body = read.kind === 'ok' ? usage.safeParse(read.body) : undefined
    if (body?.success !== true) return { status: 'failed' }
    return { status: 'ready', value: [], bonusWallets: [], steps: stepsOf(body.data) }
  }

  /**
   * Read `/api/agent/me` once for the profile and balance queries that one refresh starts together.
   * @param stored - current grant whose token authorizes the read.
   * @param lifetime - details lifetime the read belongs to.
   * @returns the response body, a failure, or `stale` once the credential changed or was rejected.
   */
  private readMe(stored: Grant, lifetime: AbortController): Promise<MeRead> {
    const current = this.meRead
    if (current?.token === stored.token && current.lifetime === lifetime) return current.result
    const entry = { token: stored.token, lifetime, result: this.fetchMe(stored, lifetime) }
    this.meRead = entry
    void entry.result.finally(() => { if (this.meRead === entry) this.meRead = undefined })
    return entry.result
  }

  /**
   * @param stored - current grant whose token authorizes the read.
   * @param lifetime - details lifetime the read belongs to.
   * @returns one `/api/agent/me` outcome; a 401 expires the credential first.
   */
  private async fetchMe(stored: Grant, lifetime: AbortController): Promise<MeRead> {
    let response: PetoResponse
    try {
      response = await requestPeto(this.origin, '/api/agent/me', { method: 'GET', token: stored.token },
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(this.requestTimeout)]))
    } catch (_failed) {
      return this.detailsLifetime === lifetime ? { kind: 'failed' } : { kind: 'stale' }
    }
    if (this.detailsLifetime !== lifetime) return { kind: 'stale' }
    if (response.status === 401) {
      await this.expireCredential(stored.token, lifetime)
      return { kind: 'stale' }
    }
    return response.status === 200 ? { kind: 'ok', body: response.body } : { kind: 'failed' }
  }

  override async getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    const stored = await this.readCurrentGrant(this.detailsLifetime)
    return stored === null ? null : { accountId: stored.deviceId as AccountUserId, bonuses: [] }
  }

  override ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async startSignIn(
    _client: AccountClientMetadata, _callbackOrigin: string, _loginSource: 'web' | 'desktop',
  ): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    if (this.closed) throw new PetoAuthError('protocol')
    if (this.attempt !== undefined && ACTIVE_PHASES.has(this.attempt.view.phase)) return this.getState()
    const previous = this.attempt
    if (previous !== undefined) {
      await previous.done
      // Disposal can close the provider while the previous attempt settles.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can set `closed` while the attempt is awaited.
      if (this.closed) throw new PetoAuthError('protocol')
      if (this.attempt !== previous) return this.getState()
    }
    const attempt: Attempt = {
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' },
      controller: new AbortController(), done: Promise.resolve(), running: Promise.resolve(),
    }
    this.attempt = attempt
    attempt.done = this.ctx.authorization.begin({
      key: KEY, signal: attempt.controller.signal,
      /* v8 ignore next -- the device-code flow never prompts; a prompt would be a protocol violation. */
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new PetoAuthError('protocol')) },
    }).then((outcome) => {
      this.update(attempt, { phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled' })
    }).catch((error: unknown) => {
      // A refusal on the approval page is the user's own cancellation, not a failure to report.
      if (error instanceof PetoDeniedError) { this.update(attempt, { phase: 'cancelled' }); return }
      const code = error instanceof PetoAuthError ? error.code : 'protocol'
      console.error('[peto-account] sign-in failed', { errorCode: code })
      this.update(attempt, { phase: code === 'expired' ? 'expired' : 'failed', errorCode: code })
    }).then(async () => {
      // begin() may report cancellation before the HTTP work observes its signal.
      await attempt.running.catch(() => undefined)
    })
    this.changed()
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      if (attempt.view.phase !== 'committing') {
        attempt.controller.abort()
        this.ctx.authorization.cancel(KEY)
      }
      await attempt.done
    }
    return this.getState()
  }

  override signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.closed) throw new PetoAuthError('protocol')
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const stored = await this.readGrant()
      if (stored !== undefined) {
        await this.ctx.credentials.deleteRecord(KEY)
        if (stored.server === this.origin) this.revoke(stored.token)
      }
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal, includeIdentityChanges = false): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const wakeUp = (): void => { dirty = true; wake?.() }
    const changed = (identityOnly: boolean): void => { if (!identityOnly || includeIdentityChanges) wakeUp() }
    this.listeners.add(changed)
    signal.addEventListener('abort', wakeUp, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', wakeUp)
    }
  }

  override async resolveToken(url: string): Promise<string | undefined> {
    if (this.closed || this.removing !== undefined) return undefined
    const destination = new URL(url)
    if (destination.origin !== this.origin || destination.username || destination.password) return undefined
    const stored = await this.readGrant()
    return stored?.server === this.origin ? stored.token : undefined
  }

  override async rejectToken(token: string): Promise<void> {
    const lifetime = this.detailsLifetime
    const stored = await this.readCurrentGrant(lifetime)
    if (stored?.token !== token || this.detailsLifetime !== lifetime) return
    await this.expireCredential(token, lifetime)
  }

  override getPlatformSession(): Promise<PlatformSession | null> {
    // Peto Web has no embedded account pages; its own browser session owns them.
    return Promise.resolve(null)
  }

  override async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    const stored = await this.readGrant()
    return {
      ...stored === undefined ? {} : { deviceId: stored.deviceId, userId: stored.deviceId as AccountUserId },
      osVersion: `${platform()} ${release()}`,
    }
  }

  private async readGrant(): Promise<Grant | undefined> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return undefined
    if (record.kind !== 'grant') throw new PetoAuthError('storage')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new PetoAuthError('storage')
    return parsed.data
  }

  private async readCurrentGrant(lifetime: AbortController): Promise<Grant | null> {
    if (this.closed) return null
    const stored = await this.readGrant()
    if (stored === undefined || lifetime.signal.aborted) return null
    if (stored.server !== this.origin) throw new PetoAuthError('protocol')
    return stored
  }

  private async expireCredential(token: string, lifetime: AbortController): Promise<void> {
    this.removing ??= (async () => {
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const stored = await this.readGrant()
      if (this.closed || this.detailsLifetime !== lifetime || stored?.token !== token) return this.getState()
      await this.ctx.credentials.deleteRecord(KEY)
      this.ctx.emit('deepseek-account/session-expired')
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    await this.removing
  }

  /** Revoke the removed token on Peto Web in the background; a failure never restores the local grant. */
  private revoke(token: string): void {
    if (this.closed) return
    const revocation = requestPeto(this.origin, '/api/agent/logout', { method: 'POST', token },
      AbortSignal.any([this.logoutLifetime.signal, AbortSignal.timeout(this.requestTimeout)])).then(() => undefined, () => {
      // The device stays listed in Peto Web until revoked there or idle-expired; local sign-out already succeeded.
    }).finally(() => { this.revocations.delete(revocation) })
    this.revocations.add(revocation)
  }

  private invalidateDetails(): void {
    this.lastProfile = undefined
    this.detailsLifetime.abort()
    this.detailsLifetime = new AbortController()
  }

  private changed(identityOnly = false): void { for (const listener of this.listeners) listener(identityOnly) }

  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void {
    const { authorizeUrl: _url, ...rest } = attempt.view
    attempt.view = { ...rest, ...value }
    this.changed()
  }

  private async run(session: AuthorizationSession, attempt: Attempt): Promise<void> {
    const deadline = new AbortController()
    const signal = AbortSignal.any([session.signal, deadline.signal])
    let timer = setTimeout(() => { deadline.abort() }, this.attemptTimeout)
    try {
      const response = await requestPeto(this.origin, '/api/agent/device/start', { method: 'POST', body: { name: this.deviceName } },
        AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]))
      if (response.status !== 200) throw new PetoAuthError('network')
      const start = started.safeParse(response.body)
      if (!start.success) throw new PetoAuthError('protocol')
      const authorizeUrl = verificationUrl(this.origin, start.data)
      const now = Date.now()
      const expiresAt = Math.min(now + this.attemptTimeout, now + start.data.expires_in * 1000)
      clearTimeout(timer)
      timer = setTimeout(() => { deadline.abort() }, expiresAt - now)
      this.update(attempt, { phase: 'waiting-browser', authorizeUrl, expiresAt })
      const token = await this.poll(start.data.device_code, start.data.interval * 1000, signal)
      this.update(attempt, { phase: 'committing' })
      clearTimeout(timer)
      try {
        const payload: Grant = {
          version: 1, server: this.origin, token: token.token,
          deviceId: token.device_id, deviceName: token.device_name, account: token.account,
        }
        await session.commit({ kind: 'grant', payload })
      } catch { throw new PetoAuthError('storage') }
    } catch (error) {
      if (deadline.signal.aborted) throw new PetoAuthError('expired')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** Poll at the server's interval until the code is approved, refused or expired. */
  private async poll(deviceCode: string, intervalMs: number, signal: AbortSignal): Promise<Extract<DevicePoll, { status: 'issued' }>['token']> {
    let failures = 0
    for (;;) {
      await sleep(intervalMs, undefined, { signal })
      let result: DevicePoll
      try {
        result = await pollDevice(this.origin, deviceCode, AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]))
      } catch (error) {
        signal.throwIfAborted()
        // A dropped connection or a passing server error does not lose a code the user may still approve.
        const transient = error instanceof PetoAuthError && (error.code === 'no-response' || error.code === 'network')
        if (!transient || ++failures > POLL_FAILURES) throw error
        continue
      }
      failures = 0
      switch (result.status) {
        case 'pending': continue
        case 'expired': throw new PetoAuthError('expired')
        case 'denied': throw new PetoDeniedError()
        case 'issued': return result.token
        /* v8 ignore next -- exhaustive over DevicePoll; reached only if a new poll outcome is added unhandled. */
        default: return assertNever(result, 'peto-account device poll')
      }
    }
  }
}
export default PetoAccount

/**
 * Project the step fields of `/api/agent/me` onto the shared account balance.
 * @param body - validated step fields.
 * @returns today's steps; an unreadable reset time is left out.
 */
function stepsOf(body: z.infer<typeof usage>): AccountSteps {
  const reset = body.steps_reset_at === undefined ? Number.NaN : Date.parse(body.steps_reset_at)
  return {
    used: Math.min(body.steps_used, body.steps_limit),
    limit: body.steps_limit,
    ...Number.isNaN(reset) ? {} : { resetsAt: new Date(reset).toISOString() },
    tokens: body.tokens_used,
    costs: body.models.map(model => ({ model: model.label, steps: model.step_cost })),
  }
}

/** Project the stored device onto the account profile shared with DeepSeek's UI. */
function profileOf(stored: Grant, account: string): ReadyProfile {
  return { status: 'ready', value: { id: stored.deviceId as AccountUserId, name: account, contact: null, avatarUrl: null } }
}
