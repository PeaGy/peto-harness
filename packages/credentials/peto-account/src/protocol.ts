/** Validated Peto Web Agent API messages and browser destinations. */
import { z } from 'zod'
import type { SignInErrorCode } from '@deepseek-ai/dsh-deepseek-account/types'

/** Protocol errors expose a stable code, never a response body or a device token. */
export class PetoAuthError extends Error {
  /** @param code - safe error classification rendered by the caller's locale dictionary. */
  constructor(readonly code: SignInErrorCode) { super(`peto-account: ${code}`) }
}

/** The user refused this device on the Peto Web approval page. */
export class PetoDeniedError extends Error {
  constructor() { super('peto-account: denied') }
}

/**
 * Accept an HTTPS Peto Web origin, or an explicitly enabled loopback HTTP development origin.
 * @param value - configured server address.
 * @param allowLoopbackHttp - development-only opt-in.
 * @returns normalized origin.
 */
export function serverOrigin(value: string, allowLoopbackHttp: boolean): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !(url.protocol === 'https:' || (allowLoopbackHttp && loopback && url.protocol === 'http:'))) {
    throw new Error('peto-account: server must be an HTTPS origin or an explicitly enabled loopback HTTP origin')
  }
  return url.origin
}

/** Successful `POST /api/agent/device/start` response. */
export const started = z.object({
  device_code: z.string().min(16),
  user_code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  verification_url: z.string().nullable().optional(),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
})

/** Successful `POST /api/agent/device/token` response; the token is issued exactly once. */
export const issued = z.object({
  token: z.string().regex(/^peto_[\x21-\x7e]+$/),
  device_id: z.string().min(1),
  device_name: z.string(),
  account: z.string(),
})

/** Display fields of `GET /api/agent/me`; other fields are discarded. */
export const me = z.object({ account: z.string().min(1) })

/**
 * Choose the approval page for one device code. Peto Web returns an absolute link only when its frontend address is
 * configured; otherwise the page is the server root with the code in `agent_code`.
 * @param origin - configured Peto Web origin.
 * @param start - validated device-code response.
 * @returns HTTPS or loopback HTTP page that carries this exact code.
 */
export function verificationUrl(origin: string, start: z.infer<typeof started>): string {
  const fallback = new URL('/', origin)
  fallback.searchParams.set('agent_code', start.user_code)
  if (start.verification_url == null) return fallback.href
  let url: URL
  try { url = new URL(start.verification_url) } catch { throw new PetoAuthError('protocol') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.hash || url.searchParams.get('agent_code') !== start.user_code
    || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new PetoAuthError('protocol')
  }
  return url.href
}

/** One bounded Peto Web response: its status and parsed JSON body, if any. */
export interface PetoResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * Call one fixed Peto Web Agent endpoint. Redirects fail so a token never follows a redirect to another host.
 * @param origin - configured Peto Web origin.
 * @param path - fixed endpoint path.
 * @param request - method, optional JSON body and optional device token.
 * @param signal - attempt or credential lifetime combined with the request deadline.
 * @returns status and body; a body that is not JSON reads as undefined.
 * @throws the signal's reason when aborted, PetoAuthError `no-response` when fetch returns no Response.
 */
export async function requestPeto(origin: string, path: string,
  request: { readonly method: 'GET' | 'POST'; readonly body?: unknown; readonly token?: string },
  signal: AbortSignal): Promise<PetoResponse> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (request.body !== undefined) headers['content-type'] = 'application/json'
  if (request.token !== undefined) headers.authorization = `Bearer ${request.token}`
  let response: Response
  try {
    response = await fetch(new URL(path, origin), {
      method: request.method, headers, redirect: 'error', signal,
      ...request.body === undefined ? {} : { body: JSON.stringify(request.body) },
    })
  } catch (error) {
    rethrowCancellation(signal)
    console.error('[peto-account] request failed', { path, reason: error instanceof Error ? error.name : typeof error })
    throw new PetoAuthError('no-response')
  }
  let body: unknown
  try { body = await response.json() } catch (_notJson) {
    // Error pages from proxies are HTML; callers judge the status alone.
    rethrowCancellation(signal)
  }
  return { status: response.status, body }
}

/** Let a caller's cancellation propagate as itself while a request deadline reads as `no-response`. */
function rethrowCancellation(signal: AbortSignal): void {
  if (!signal.aborted) return
  const reason: unknown = signal.reason
  if (reason instanceof DOMException && reason.name === 'TimeoutError') throw new PetoAuthError('no-response')
  throw reason
}

/** One device-token poll outcome. */
export type DevicePoll =
  | { readonly status: 'pending' }
  | { readonly status: 'expired' }
  | { readonly status: 'denied' }
  | { readonly status: 'issued'; readonly token: z.infer<typeof issued> }

/**
 * Ask Peto Web whether the user approved one device code.
 * @param origin - configured Peto Web origin.
 * @param deviceCode - code from the device-code response, never shown to the user.
 * @param signal - attempt lifetime combined with the request deadline.
 * @returns the approval state, or the issued token once.
 * @throws PetoAuthError `network` for other HTTP statuses, `protocol` for an invalid token response.
 */
export async function pollDevice(origin: string, deviceCode: string, signal: AbortSignal): Promise<DevicePoll> {
  const response = await requestPeto(origin, '/api/agent/device/token', { method: 'POST', body: { device_code: deviceCode } }, signal)
  switch (response.status) {
    case 200: {
      const token = issued.safeParse(response.body)
      if (!token.success) throw new PetoAuthError('protocol')
      return { status: 'issued', token: token.data }
    }
    case 428: return { status: 'pending' }
    case 410: return { status: 'expired' }
    case 403: return { status: 'denied' }
    default: throw new PetoAuthError('network')
  }
}
