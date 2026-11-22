/**
 * Peto: gzip request bodies of model calls to Peto Web. Every step resends the whole conversation, often hundreds of
 * kilobytes of text; compressed, the upload takes a fraction of the time, so a weak upload path through Cloudflare is
 * less likely to cut it off midway. Peto Web reads `Content-Encoding: gzip` on its agent endpoints.
 * @module @deepseek-ai/dsh-llm-peto-account/compress
 */
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

const deflate = promisify(gzip)

/** Smallest body worth compressing; smaller requests already upload in one round trip. */
export const GZIP_MIN_BYTES = 16 * 1024

/**
 * Wrap a fetch so that a large string body is sent gzip-compressed; any other request passes through unchanged.
 * @param base - fetch that sends the request, `globalThis.fetch` when omitted.
 * @returns a fetch for the model requests of one Peto Web origin.
 */
export function gzipRequests(base: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const body = init?.body
    if (typeof body !== 'string' || Buffer.byteLength(body) < GZIP_MIN_BYTES) return base(input, init)
    const headers = new Headers(init?.headers)
    if (headers.has('content-encoding')) return base(input, init)
    headers.set('content-encoding', 'gzip')
    headers.delete('content-length')
    return base(input, { ...init, headers, body: new Uint8Array(await deflate(body)) })
  }
}
