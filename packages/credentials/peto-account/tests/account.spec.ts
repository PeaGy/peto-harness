import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type {
  AccountBonusOrderId, AccountClientMetadata, AccountUserId, DeepSeekAccount, SignInAttemptId,
} from '@deepseek-ai/dsh-deepseek-account'
import { KEY, PetoAccount, resolveDeviceName, serverOrigin, verificationUrl } from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length) await cleanups.pop()!()
})

const client: AccountClientMetadata = { version: '1.2.3', locale: 'en', timezoneOffsetSeconds: 25_200 }
const TOKEN = 'peto_fixture-device-token'

type Reply = { status: number; body?: unknown }
interface Server {
  origin: string
  /** Replies to successive device-token polls; the last one repeats. */
  polls: Reply[]
  start: Reply | ((origin: string) => Reply)
  me: Reply
  /** Leave every request unanswered. */
  hold: boolean
  received: Array<{ method: string | undefined; path: string | undefined; authorization: string | undefined; body: unknown }>
}

async function peto(): Promise<Server> {
  const state: Server = {
    origin: '',
    polls: [{ status: 428 }, { status: 200, body: { token: TOKEN, device_id: 'device-1', device_name: 'Workstation', account: 'Ada' } }],
    start: { status: 200, body: { device_code: 'd'.repeat(24), user_code: 'ABCD-EFGH', verification_url: null, expires_in: 600, interval: 0.01 } },
    me: { status: 200, body: { account: 'Ada Lovelace', steps_used: 3 } },
    hold: false,
    received: [],
  }
  const reply = (res: ServerResponse, { status, body }: Reply): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body))
  }
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let text = ''
    for await (const chunk of req) text += String(chunk)
    const body: unknown = text ? JSON.parse(text) : undefined
    state.received.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body })
    if (state.hold) return
    if (req.url === '/api/agent/device/start') reply(res, typeof state.start === 'function' ? state.start(state.origin) : state.start)
    else if (req.url === '/api/agent/device/token') reply(res, state.polls.length > 1 ? state.polls.shift()! : state.polls[0])
    else if (req.url === '/api/agent/me') reply(res, state.me)
    else if (req.url === '/api/agent/logout') reply(res, { status: 200, body: { revoked: true } })
    else reply(res, { status: 404 })
  }
  const server = createServer((req, res) => { void handle(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing listener')
  state.origin = `http://127.0.0.1:${address.port}`
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return state
}

async function fixture(server: Server, config: Record<string, unknown> = {}, home?: string) {
  const directory = home ?? await mkdtemp(join(tmpdir(), 'dsh-peto-account-'))
  if (home === undefined) cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(directory, 'credentials.yaml'), watch: false })
  await credentials
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  const provider = ctx.plugin(PetoAccount, { server: server.origin, allowLoopbackHttp: true, deviceName: 'Workstation', ...config })
  await provider
  cleanups.push(async () => { await provider.dispose(); await authorization.dispose(); await credentials.dispose() })
  const account = ctx.deepseekAccount as PetoAccount
  const states = new AbortController()
  cleanups.push(async () => { states.abort() })
  const events: string[] = []
  ctx.on('deepseek-account/signed-out', () => { events.push('signed-out') })
  ctx.on('deepseek-account/session-expired', () => { events.push('session-expired') })
  const wait = async (phase: string) => {
    for await (const state of account.watch(states.signal)) if (state.attempt?.phase === phase) return state
    throw new Error(`missing phase ${phase}`)
  }
  return { ctx, account, wait, events, home: directory, dispose: () => provider.dispose() }
}

async function signedIn(server: Server, config: Record<string, unknown> = {}) {
  const f = await fixture(server, config)
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  await f.wait('succeeded')
  return f
}

it('signs in through the device code and scopes the token to the configured server', async () => {
  const server = await peto()
  const f = await fixture(server)
  expect((await f.account.getState()).status).toBe('signed-out')
  const started = await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect(started.attempt?.phase).toBe('initializing')
  const waiting = await f.wait('waiting-browser')
  expect(waiting.attempt?.authorizeUrl).toBe(`${server.origin}/?agent_code=ABCD-EFGH`)
  expect(waiting.attempt?.expiresAt).toBeGreaterThan(Date.now())
  expect((await f.account.startSignIn(client, 'http://127.0.0.1:1', 'web')).attempt?.id).toBe(started.attempt?.id)
  const done = await f.wait('succeeded')
  expect(done.status).toBe('credential-stored')
  expect(done.links).toEqual({ usageUrl: `${server.origin}/`, topUpUrl: `${server.origin}/` })
  expect(server.received[0]).toMatchObject({ method: 'POST', path: '/api/agent/device/start', body: { name: 'Workstation' } })
  expect(server.received.filter(row => row.path === '/api/agent/device/token').map(row => row.body))
    .toEqual([{ device_code: 'd'.repeat(24) }, { device_code: 'd'.repeat(24) }])
  expect(await f.account.resolveToken(`${server.origin}/api/agent/v1`)).toBe(TOKEN)
  expect(await f.account.resolveToken('https://api.deepseek.com/v1')).toBeUndefined()
  expect(await f.account.resolveToken(`http://user:pass@${server.origin.slice(7)}/api/agent/v1`)).toBeUndefined()
  expect(await f.account.getProfile(client)).toEqual({
    status: 'ready', value: { id: 'device-1', name: 'Ada Lovelace', contact: null, avatarUrl: null },
  })
  expect(server.received.find(row => row.path === '/api/agent/me')?.authorization).toBe(`Bearer ${TOKEN}`)
  expect(await f.account.getBalance(client)).toEqual({ status: 'ready', value: [], bonusWallets: [] })
  expect(await f.account.getUnnotifiedBonuses(client)).toEqual({ accountId: 'device-1', bonuses: [] })
  const shared: DeepSeekAccount = f.account
  expect(await shared.ackBonusNotified('device-1' as AccountUserId, 'order' as AccountBonusOrderId, client)).toBe(false)
  expect(await f.account.getPlatformSession()).toBeNull()
  expect(await f.account.getDeviceIdentity()).toMatchObject({ deviceId: 'device-1', userId: 'device-1' })
})

it('opens the approval link the server returns when it carries the same code', async () => {
  const server = await peto()
  server.start = origin => ({ status: 200, body: {
    device_code: 'd'.repeat(24), user_code: 'ABCD-EFGH', verification_url: `${origin}/?agent_code=ABCD-EFGH`, expires_in: 600, interval: 0.01,
  } })
  const f = await fixture(server)
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('waiting-browser')).attempt?.authorizeUrl).toBe(`${server.origin}/?agent_code=ABCD-EFGH`)
})

it.each([
  { name: 'a different code', url: 'https://peto.example/?agent_code=ZZZZ-ZZZZ' },
  { name: 'plain HTTP off loopback', url: 'http://peto.example/?agent_code=ABCD-EFGH' },
  { name: 'credentials', url: 'https://user@peto.example/?agent_code=ABCD-EFGH' },
  { name: 'an unparsable address', url: 'not a url' },
])('refuses a returned approval link with $name', ({ url }) => {
  const start = { device_code: 'd'.repeat(24), user_code: 'ABCD-EFGH', verification_url: url, expires_in: 600, interval: 1 }
  expect(() => verificationUrl('https://peto.example', start)).toThrow('peto-account: protocol')
})

it.each([
  { name: 'a refusal', poll: { status: 403 }, phase: 'cancelled', errorCode: undefined },
  { name: 'an expired code', poll: { status: 410 }, phase: 'expired', errorCode: 'expired' },
  { name: 'an invalid token response', poll: { status: 200, body: { token: 'not-a-peto-token' } }, phase: 'failed', errorCode: 'protocol' },
  { name: 'an unexpected status', poll: { status: 418 }, phase: 'failed', errorCode: 'network' },
])('ends the attempt on $name without storing a token', async ({ poll, phase, errorCode }) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  server.polls = [poll]
  const f = await fixture(server)
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  const state = await f.wait(phase)
  expect(state.status).toBe('signed-out')
  expect(state.attempt?.errorCode).toBe(errorCode)
  expect(state.attempt?.authorizeUrl).toBeUndefined()
})

it.each([
  { name: 'refuses to start', start: { status: 429, body: { detail: 'busy' } }, errorCode: 'network' },
  { name: 'returns an invalid start response', start: { status: 200, body: { device_code: 'short' } }, errorCode: 'protocol' },
  { name: 'returns HTML', start: { status: 502 }, errorCode: 'network' },
])('reports a server that $name', async ({ start, errorCode }) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  server.start = start
  const f = await fixture(server)
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('failed')).attempt?.errorCode).toBe(errorCode)
})

it('reports no-response when the server cannot be reached', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  const f = await fixture(server, { server: 'http://127.0.0.1:9' })
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('failed')).attempt?.errorCode).toBe('no-response')
})

it('reports a request deadline as no-response', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  server.hold = true
  const f = await fixture(server, { requestTimeoutMs: 50 })
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('failed')).attempt?.errorCode).toBe('no-response')
})

it('fails an approved attempt whose token cannot be stored', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  const f = await fixture(server)
  vi.spyOn(f.ctx.credentials, 'modifyRecord').mockRejectedValue(new Error('disk full'))
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect(await f.wait('failed')).toMatchObject({ status: 'signed-out', attempt: { errorCode: 'storage' } })
})

it('keeps polling through passing failures and gives up after repeated ones', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  const approved = server.polls[1]
  server.polls = [{ status: 500 }, { status: 503 }, { status: 428 }, approved]
  const f = await fixture(server)
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('succeeded')).status).toBe('credential-stored')

  const second = await peto()
  second.polls = [{ status: 500 }]
  const g = await fixture(second)
  await g.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await g.wait('failed')).attempt?.errorCode).toBe('network')
  expect(second.received.filter(row => row.path === '/api/agent/device/token')).toHaveLength(4)
})

it('expires an attempt at its local deadline', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = await peto()
  server.polls = [{ status: 428 }]
  const f = await fixture(server, { attemptTimeoutMs: 80 })
  await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect((await f.wait('expired')).attempt?.errorCode).toBe('expired')
})

it('cancels a waiting attempt so a later approval is never stored', async () => {
  const server = await peto()
  server.polls = [{ status: 428 }]
  const f = await fixture(server)
  const started = await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  await f.wait('waiting-browser')
  const cancelled = await f.account.cancelSignIn(started.attempt!.id)
  expect(cancelled.attempt?.phase).toBe('cancelled')
  expect((await f.account.cancelSignIn('other' as SignInAttemptId)).attempt?.phase).toBe('cancelled')
  server.polls = [{ status: 200, body: { token: TOKEN, device_id: 'device-1', device_name: 'Workstation', account: 'Ada' } }]
  await new Promise(resolve => setTimeout(resolve, 50))
  expect((await f.account.getState()).status).toBe('signed-out')
  // A new attempt starts after the cancelled one settled.
  const next = await f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')
  expect(next.attempt?.id).not.toBe(started.attempt?.id)
  expect((await f.wait('succeeded')).status).toBe('credential-stored')
})

it('signs out locally and revokes the device on Peto Web', async () => {
  const server = await peto()
  const f = await signedIn(server)
  const out = await f.account.signOut(client)
  expect(out).toMatchObject({ status: 'signed-out', attempt: null })
  expect(f.events).toEqual(['signed-out'])
  expect(await f.account.resolveToken(`${server.origin}/api/agent/v1`)).toBeUndefined()
  await vi.waitFor(() => {
    expect(server.received.find(row => row.path === '/api/agent/logout')).toMatchObject({ method: 'POST', authorization: `Bearer ${TOKEN}` })
  })
  await f.dispose()
  await expect(f.account.signOut(client)).rejects.toThrow('peto-account: protocol')
  await expect(f.account.startSignIn(client, 'http://127.0.0.1:1', 'desktop')).rejects.toThrow('peto-account: protocol')
})

it('removes a token Peto Web rejects and emits the expiry notification', async () => {
  const server = await peto()
  const f = await signedIn(server)
  await f.account.rejectToken('peto_some-other-token')
  expect((await f.account.getState()).status).toBe('credential-stored')
  server.me = { status: 401, body: { detail: 'expired' } }
  expect(await f.account.getProfile(client)).toBeNull()
  expect(f.events).toEqual(['session-expired', 'signed-out'])
  expect((await f.account.getState()).status).toBe('signed-out')
  expect(await f.account.getProfile(client)).toBeNull()
  expect(await f.account.getBalance(client)).toBeNull()
  expect(await f.account.getUnnotifiedBonuses(client)).toBeNull()

  const again = await signedIn(await peto())
  await again.account.rejectToken(TOKEN)
  expect(again.events).toEqual(['session-expired', 'signed-out'])
})

it('keeps the name read at sign-in when the profile cannot be refreshed', async () => {
  const server = await peto()
  const f = await signedIn(server)
  server.me = { status: 500 }
  expect(await f.account.getProfile(client)).toMatchObject({ status: 'ready', value: { name: 'Ada' } })
  server.me = { status: 200, body: { account: 'Ada Lovelace' } }
  expect(await f.account.getProfile(client)).toMatchObject({ value: { name: 'Ada Lovelace' } })
  server.me = { status: 200, body: { unexpected: true } }
  expect(await f.account.getProfile(client)).toMatchObject({ value: { name: 'Ada Lovelace' } })
  await f.dispose()
  expect(await f.account.getProfile(client)).toBeNull()
})

it('keeps the stored name when the profile request cannot reach the server', async () => {
  const server = await peto()
  const f = await signedIn(server)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
  expect(await f.account.getProfile(client)).toMatchObject({ status: 'ready', value: { name: 'Ada' } })
})

it('drops a token issued by another server when it mounts', async () => {
  const server = await peto()
  const f = await signedIn(server)
  await f.dispose()
  const other = await peto()
  const g = await fixture(other, {}, f.home)
  expect((await g.account.getState()).status).toBe('signed-out')
})

it('refuses stored records it did not write', async () => {
  const server = await peto()
  const f = await fixture(server)
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
  await expect(f.account.getState()).rejects.toThrow('peto-account: storage')
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: { version: 2 } }))
  await expect(f.account.getState()).rejects.toThrow('peto-account: storage')
  await expect(f.account[Service.init]()).rejects.toThrow('peto-account: storage')
})

it('refuses to forward a token bound to another server', async () => {
  const server = await peto()
  const f = await signedIn(server)
  const record = await f.ctx.credentials.readRecord(KEY)
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { ...(record as { payload: Record<string, unknown> }).payload, server: 'https://elsewhere.example' },
  }))
  expect(await f.account.resolveToken(`${server.origin}/api/agent/v1`)).toBeUndefined()
  await expect(f.account.getBalance(client)).rejects.toThrow('peto-account: protocol')
})

it('validates its configuration', () => {
  expect(serverOrigin('https://peto.example/', false)).toBe('https://peto.example')
  expect(serverOrigin('http://localhost:8000', true)).toBe('http://localhost:8000')
  for (const value of ['http://localhost:8000', 'https://peto.example/api', 'https://u:p@peto.example', 'http://peto.example']) {
    expect(() => serverOrigin(value, value.includes('localhost') ? false : true)).toThrow('peto-account: server must be')
  }
  expect(resolveDeviceName(' Laptop ')).toBe('Laptop')
  expect(resolveDeviceName('')).not.toBe('')
  expect(() => new PetoAccount(new Context(), {} as never)).toThrow()
})
