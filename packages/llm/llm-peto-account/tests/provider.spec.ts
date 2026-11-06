/** The Peto route lists the account's gateway models and streams through pi-ai with the account's device token. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import * as Peto from '../src/index.ts'

const TOKEN = 'peto_fixture-device-token'
const LISTING = {
  object: 'list',
  data: [
    { id: 'peto', object: 'model', display_name: 'Peto', context_window: 500_000, max_output_tokens: 64_000, reasoning_efforts: ['low', 'medium', 'high'] },
    { id: 'luna', object: 'model', display_name: '6 Luna', context_window: 1_050_000, max_output_tokens: 128_000, reasoning_efforts: ['none', 'low', 'high', 'max'] },
  ],
}
const REPLY = [
  { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
  { type: 'response.in_progress', response: { id: 'resp_1', status: 'in_progress', output: [] } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] } },
  { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', content_index: 0, delta: 'hello' },
  { type: 'response.output_item.done', output_index: 0, item: {
    type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'hello', annotations: [] }],
  } },
  { type: 'response.completed', response: {
    id: 'resp_1', status: 'completed', output: [],
    usage: {
      input_tokens: 3, output_tokens: 1, total_tokens: 4,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
    },
  } },
]

const contexts: Context[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })))
  vi.restoreAllMocks()
})

interface Gateway {
  origin: string
  baseURL: string
  listing: { status: number; body?: unknown }
  /** Error answer to `/responses`, in the gateway's OpenAI shape; absent streams {@link REPLY}. */
  failure?: { status: number; body: unknown }
  requests: Array<{ path: string | undefined; authorization: string | undefined; body: unknown }>
}

async function gateway(): Promise<Gateway> {
  const state: Gateway = { origin: '', baseURL: '', listing: { status: 200, body: LISTING }, requests: [] }
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let text = ''
    for await (const chunk of req) text += String(chunk)
    state.requests.push({ path: req.url, authorization: req.headers.authorization, body: text ? JSON.parse(text) : undefined })
    if (req.method === 'GET' && req.url === '/api/agent/v1/models') {
      res.writeHead(state.listing.status, { 'content-type': 'application/json' })
        .end(state.listing.body === undefined ? 'not json' : JSON.stringify(state.listing.body))
    } else if (req.method === 'POST' && req.url === '/api/agent/v1/responses' && state.failure !== undefined) {
      res.writeHead(state.failure.status, { 'content-type': 'application/json', 'x-should-retry': 'false' })
        .end(JSON.stringify(state.failure.body))
    } else if (req.method === 'POST' && req.url === '/api/agent/v1/responses') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
        .end(REPLY.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    } else res.writeHead(404).end()
  }
  const server = createServer((req, res) => { void handle(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  state.origin = `http://127.0.0.1:${address.port}`
  state.baseURL = `${state.origin}/api/agent/v1`
  return state
}

async function host(server: Gateway, token: () => string | undefined = () => TOKEN, config: Partial<Peto.Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const rejected: string[] = []
  ctx.provide('deepseekAccount', {
    resolveToken: (url: string) => Promise.resolve(new URL(url).origin === server.origin ? token() : undefined),
    rejectToken: (value: string) => { rejected.push(value); return Promise.resolve() },
  } as DeepSeekAccount)
  const updates: string[] = []
  ctx.on('llm/models-updated', (provider) => { updates.push(provider) })
  await ctx.plugin(Peto, { baseURL: `${server.baseURL}/`, ...config })
  return { ctx, rejected, updates }
}

async function assemble(ctx: Context, model: string) {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider: Peto.PROVIDER, model, reasoningEffort: ReasoningEffortId('high'),
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'model', provider: 'peto', model } })],
  })) assembler.push(chunk)
  return { message: assembler.message({ provider: Peto.PROVIDER, model }), finish: assembler.finish }
}

it('lists the account models from the gateway with their names and efforts', async () => {
  const server = await gateway()
  const { ctx, updates } = await host(server)
  await vi.waitFor(() => { expect(updates).toEqual(['peto']) })
  const models = await ctx.llm.listModels('peto')
  expect(models.map(row => [row.id, row.name, row.inputModalities])).toEqual([
    ['peto', 'Peto', ['text', 'image']], ['luna', '6 Luna', ['text', 'image']],
  ])
  const listings = server.requests.filter(row => row.path === '/api/agent/v1/models')
  expect(listings).toHaveLength(1)
  expect(listings[0]?.authorization).toBe(`Bearer ${TOKEN}`)
  const resolved = await ctx.llm.resolveModelInfo('peto', 'luna')
  expect(resolved.context?.contextWindow).toBe(1_050_000)
  expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'high', 'max'])
})

it('streams a reply through the gateway with the device token', async () => {
  const server = await gateway()
  const { ctx } = await host(server)
  const result = await assemble(ctx, 'peto')
  expect(result.finish).toEqual({ kind: 'stop' })
  expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  const call = server.requests.find(row => row.path === '/api/agent/v1/responses')
  expect(call?.authorization).toBe(`Bearer ${TOKEN}`)
  expect(call?.body).toMatchObject({ model: 'peto', stream: true, reasoning: { effort: 'high' } })
})

it('reports used-up daily steps as the account quota and leaves other failures alone', async () => {
  const server = await gateway()
  const { ctx } = await host(server)
  server.failure = { status: 429, body: { error: {
    message: 'Hôm nay tài khoản đã dùng hết 200 bước Peto Agent.', type: 'insufficient_quota', code: 'insufficient_quota', param: null,
  } } }
  expect((await assemble(ctx, 'peto')).finish).toMatchObject({ kind: 'error', failure: { code: 'ACCOUNT_QUOTA' } })
  server.failure = { status: 400, body: { error: {
    message: 'Phiên đã quá 10.000 mục.', type: 'invalid_request_error', code: 'context_length_exceeded', param: null,
  } } }
  expect((await assemble(ctx, 'peto')).finish).toMatchObject({ kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } })
})

it('prepares a call against a listing loaded on demand', async () => {
  const server = await gateway()
  const { ctx } = await host(server)
  const prepared = await ctx.llm.prepareCall({ provider: Peto.PROVIDER, model: 'luna' })
  expect(prepared.config).toMatchObject({ provider: 'peto', model: 'luna', maxTokens: 128_000 })
  expect(prepared.inputModalities).toEqual(['text', 'image'])
})

it('offers no models and refuses requests while signed out', async () => {
  const server = await gateway()
  let token: string | undefined
  const { ctx, updates } = await host(server, () => token)
  expect(await ctx.llm.listModels('peto')).toEqual([])
  const failed = await assemble(ctx, 'peto')
  expect(failed.finish).toMatchObject({ kind: 'error' })
  expect(server.requests).toEqual([])

  token = TOKEN
  ctx.emit('credentials/record-updated', 'peto-account/default' as never)
  await vi.waitFor(() => { expect(updates).toEqual(['peto']) })
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  token = undefined
  ctx.emit('deepseek-account/signed-out')
  await vi.waitFor(() => { expect(updates).toEqual(['peto', 'peto']) })
  expect(await ctx.llm.listModels('peto')).toEqual([])
})

it('reports a rejected token and offers nothing for it', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const server = await gateway()
  server.listing = { status: 401, body: { error: { code: 'invalid_api_key' } } }
  const { ctx, rejected } = await host(server)
  expect(await ctx.llm.listModels('peto')).toEqual([])
  expect(rejected).toEqual([TOKEN])
})

it('keeps the listing of the same token through a failed reload and retries later', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const server = await gateway()
  const { ctx } = await host(server, () => TOKEN, { modelsMaxAgeMs: 0, modelsRetryMs: 60_000 })
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  server.listing = { status: 503 }
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  const before = server.requests.length
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  // The failure is remembered, so the next lookup inside the retry window does not call the gateway.
  expect(server.requests.length).toBe(before)
})

it('drops another token\'s listing when the new token cannot list', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const server = await gateway()
  let token = TOKEN
  const { ctx } = await host(server, () => token)
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  token = 'peto_second-device-token'
  server.listing = { status: 200, body: { data: 'not a list' } }
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  server.listing = { status: 500 }
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
})

it('clears the catalog when a new token cannot be listed', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const server = await gateway()
  let token = TOKEN
  const { ctx } = await host(server, () => token, { modelsRetryMs: 0 })
  expect(await ctx.llm.listModels('peto')).toHaveLength(2)
  token = 'peto_second-device-token'
  server.listing = { status: 500 }
  expect(await ctx.llm.listModels('peto')).toEqual([])
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
  expect(await ctx.llm.listModels('peto')).toEqual([])
})

it('translates Peto efforts into pi-ai levels', () => {
  expect(Peto.reasoningEffortsOf(['none', 'low', 'max', 'turbo'])).toEqual({ off: 'none', low: 'low', max: 'max' })
  expect(Peto.reasoningEffortsOf(undefined)).toEqual({ low: 'low', medium: 'medium', high: 'high' })
  expect(Peto.reasoningEffortsOf(['none'])).toBe(false)
  expect(Peto.parseListing({ data: [{ id: '' }] })).toBeUndefined()
  expect(Peto.parseListing({ data: [{ id: 'bare' }] })).toEqual([{ id: 'bare', name: 'bare', input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }])
})

it('validates its base URL', () => {
  expect(Peto.resolveBaseURL('https://peto.example/api/agent/v1/')).toBe('https://peto.example/api/agent/v1')
  expect(Peto.resolveBaseURL('http://localhost:8000/api/agent/v1')).toBe('http://localhost:8000/api/agent/v1')
  for (const value of ['http://peto.example/api/agent/v1', 'https://u:p@peto.example/v1', 'https://peto.example/v1?x=1']) {
    expect(() => Peto.resolveBaseURL(value)).toThrow('llm-peto-account: baseURL')
  }
})
