/** Peto: the `web_search` provider of Peto accounts searches through Peto Web in the DeepSeek Search API's shape. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import * as Peto from '../src/index.ts'
import type { WebSearchProvider } from '../src/search.ts'

const TOKEN = 'peto_fixture-device-token'
const RESULTS = {
  results: [
    { url: 'https://docs.python.org/3/library/asyncio.html', title: 'asyncio', snippet: 'Thư viện chuẩn.',
      summary: 'Thư viện chuẩn cho mã bất đồng bộ.', date: '2026-10-01' },
    { url: 'https://example.com/post', title: '', snippet: '', date: null },
  ],
}

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
  baseURL: string
  reply: { status: number; body: unknown }
  searches: Array<{ authorization: string | undefined; body: unknown }>
}

async function gateway(): Promise<Gateway> {
  const state: Gateway = { baseURL: '', reply: { status: 200, body: RESULTS }, searches: [] }
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let text = ''
    for await (const chunk of req) text += String(chunk)
    if (req.method === 'POST' && req.url === '/api/agent/v1/search') {
      state.searches.push({ authorization: req.headers.authorization, body: JSON.parse(text) })
      res.writeHead(state.reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(state.reply.body))
    } else if (req.url === '/api/agent/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [] }))
    } else res.writeHead(404).end()
  }
  const server = createServer((req, res) => { void handle(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  state.baseURL = `http://127.0.0.1:${String(address.port)}/api/agent/v1`
  return state
}

async function host(server: Gateway, token: () => string | undefined = () => TOKEN, question?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const rejected: string[] = []
  ctx.provide('deepseekAccount', {
    resolveToken: (url: string) => Promise.resolve(new URL(url).origin === new URL(server.baseURL).origin ? token() : undefined),
    rejectToken: (value: string) => { rejected.push(value); return Promise.resolve() },
  } as DeepSeekAccount)
  const providers: WebSearchProvider[] = []
  ctx.provide('web', { registerSearchProvider: (provider: WebSearchProvider) => { providers.push(provider); return () => {} } } as never)
  if (question !== undefined) {
    ctx.provide('agents', {
      currentInitiator: () => ({ session: { deriveMessages: () => [
        { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: question }] },
        { role: 'user', source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool output' }] },
      ] } }),
    } as never)
  }
  await ctx.plugin(Peto, { baseURL: server.baseURL })
  await vi.waitFor(() => { expect(providers).toHaveLength(1) })
  return { provider: providers[0] as WebSearchProvider, rejected }
}

it('registers the Peto provider and searches with the device token in the DeepSeek Search API shape', async () => {
  const server = await gateway()
  const { provider } = await host(server, () => TOKEN, `  ${'câu hỏi '.repeat(30)}`)
  expect([provider.id, provider.title, provider.available()]).toEqual(['peto', 'Peto', true])
  expect(provider.description?.en).toContain('one Peto Agent step')
  expect(await provider.ready?.('peto')).toBe(true)
  expect(await provider.search({ query: 'python asyncio', maxResults: 5 })).toEqual({
    sources: [
      { url: 'https://docs.python.org/3/library/asyncio.html', title: 'asyncio', snippet: 'Thư viện chuẩn.',
        summary: 'Thư viện chuẩn cho mã bất đồng bộ.', publishedAt: '2026-10-01' },
      { url: 'https://example.com/post' },
    ],
    truncated: false,
  })
  expect(server.searches[0]?.authorization).toBe(`Bearer ${TOKEN}`)
  const body = server.searches[0]?.body as { query: string; count: number; need_content: boolean; ori_question: string }
  expect([body.query, body.count, body.need_content]).toEqual(['python asyncio', 5, false])
  expect(Array.from(body.ori_question)).toHaveLength(128)
  expect(body.ori_question).not.toContain('  ')
  expect(body.ori_question.startsWith('câu hỏi')).toBe(true)
  await provider.search({ query: 'x', maxResults: 50 })
  expect((server.searches[1]?.body as { count: number; ori_question?: string }).count).toBe(Peto.PETO_SEARCH_COUNT)
})

it('is not ready while signed out and asks the model to have the user sign in', async () => {
  const server = await gateway()
  const { provider } = await host(server, () => undefined)
  expect(await provider.ready?.('peto')).toBe(false)
  await expect(provider.search({ query: 'x' })).rejects.toThrow('signed-in Peto account')
  expect(server.searches).toHaveLength(0)
})

it('reports a rejected token, server failures and malformed answers', async () => {
  const server = await gateway()
  const { provider, rejected } = await host(server)
  server.reply = { status: 401, body: { error: { message: 'expired' } } }
  await expect(provider.search({ query: 'x' })).rejects.toThrow('sign in to Peto again')
  expect(rejected).toEqual([TOKEN])
  server.reply = { status: 429, body: { error: { message: 'Hôm nay tài khoản đã dùng hết 2000 bước Peto Agent.' } } }
  await expect(provider.search({ query: 'x' })).rejects.toThrow('HTTP 429): Hôm nay tài khoản đã dùng hết 2000 bước')
  server.reply = { status: 200, body: { results: [{ url: 'https://a.example/', title: 3, snippet: '' }] } }
  await expect(provider.search({ query: 'x' })).rejects.toThrow('invalid web search response')
  const controller = new AbortController()
  controller.abort(new Error('stopped'))
  await expect(provider.search({ query: 'x' }, controller.signal)).rejects.toThrow('stopped')
})

it('maps the DeepSeek Search API response shape strictly', () => {
  expect(Peto.mapPetoSearch({ results: [] })).toEqual({ sources: [], truncated: false })
  for (const bad of [null, {}, { results: {} }, { results: [{ url: '', title: '', snippet: '', date: null }] },
    { results: [{ url: 'https://a.example/', title: '', snippet: '', summary: 1, date: null }] },
    { results: [{ url: 'https://a.example/', title: '', snippet: '', date: 7 }] }]) {
    expect(() => Peto.mapPetoSearch(bad)).toThrow('invalid web search response')
  }
})
