/**
 * Peto: the `web_search` provider of Peto accounts. Peto Web searches with Peto's own model and answers in the DeepSeek
 * Search API's response shape (`results` with url, title, snippet, summary and date), so the search card and the
 * model-facing text read as they do with DeepSeek's `deepseek-search-api` provider. The device token goes only to the
 * Peto Web origin; each search costs one step of the account's daily Peto Agent steps.
 * @module @deepseek-ai/dsh-llm-peto-account/search
 */

/** One citeable source of the web seam (`@deepseek-ai/dsh-web`), restated so this package does not depend on it. */
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly summary?: string
  readonly publishedAt?: string
}

/** The web seam's normalized search outcome. */
export interface WebSearchResult {
  readonly content?: string
  readonly sources: readonly WebSearchSource[]
  readonly truncated: boolean
}

/** The web seam's search request. */
export interface WebSearchRequest {
  readonly query: string
  readonly maxResults?: number
}

/** The web seam's search provider contract. */
export interface WebSearchProvider {
  readonly id: string
  readonly title?: string
  readonly description?: Readonly<Record<string, string>> & { readonly en: string }
  available(): boolean
  ready?(llmProvider: string | undefined): Promise<boolean>
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/** The web seam operation this package uses. */
export interface WebSeam {
  registerSearchProvider(provider: WebSearchProvider): () => void
}

/** Stable id the Peto provider registers under in the search registry. */
export const PETO_SEARCH_PROVIDER_ID = 'peto'

/** Results requested per search, the DeepSeek Search API's default count. */
export const PETO_SEARCH_COUNT = 10

/** Longest triggering question sent with a search, as DeepSeek's `ori_question`. */
const QUESTION_MAX_CHARS = 128

/** What one search needs, read at each search's entry. */
export interface PetoSearchOptions {
  /** Peto Agent gateway base URL; `/search` is appended. */
  readonly baseURL: string
  /** Current device token for the gateway, or undefined while signed out. Reads local state only. */
  readonly token: () => Promise<string | undefined>
  /** Report a token Peto Web rejected. */
  readonly rejectToken: (token: string) => Promise<void>
  /** Deadline for one search request. */
  readonly timeoutMs: number
  /** The user question that triggered the search, when known. */
  readonly originalQuestion?: () => string | undefined
}

function invalidResponse(): Error {
  return new Error('Peto Web returned an invalid web search response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a Peto Web search response and project it into the web seam, as DeepSeek's Search API mapping does.
 * @param response - untrusted JSON from `POST /search`.
 * @returns sources in server order with the display `snippet`, the model-facing `summary` and nullable dates.
 * @throws {Error} when the response does not contain valid search results.
 */
export function mapPetoSearch(response: unknown): WebSearchResult {
  if (!isRecord(response) || !Array.isArray(response.results)) throw invalidResponse()
  const sources = response.results.map((item: unknown) => {
    if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0
      || typeof item.title !== 'string' || typeof item.snippet !== 'string'
      || (item.summary !== undefined && typeof item.summary !== 'string')
      || (item.date !== null && typeof item.date !== 'string')) throw invalidResponse()
    return {
      url: item.url,
      ...item.title.length > 0 ? { title: item.title } : {},
      ...item.snippet.length > 0 ? { snippet: item.snippet } : {},
      ...typeof item.summary === 'string' && item.summary.length > 0 ? { summary: item.summary } : {},
      ...item.date !== null && item.date.length > 0 ? { publishedAt: item.date } : {},
    }
  })
  return { sources, truncated: false }
}

/** @returns the question with whitespace collapsed and cut to {@link QUESTION_MAX_CHARS}, as DeepSeek sends it. */
function boundedQuestion(question: string | undefined): string | undefined {
  const collapsed = question?.replace(/\s+/gu, ' ').trim() ?? ''
  if (collapsed.length === 0) return undefined
  return Array.from(collapsed).slice(0, QUESTION_MAX_CHARS).join('')
}

/** @returns the message of an OpenAI-shaped `{"error": {"message"}}` body, if any. */
async function errorMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    const error = isRecord(body) ? body.error : undefined
    return isRecord(error) && typeof error.message === 'string' && error.message.length > 0 ? error.message : undefined
  } catch (_unreadable) {
    return undefined
  }
}

/** Web search through Peto Web for Peto accounts. HTTP redirects fail; the token never leaves the Peto Web origin. */
export class PetoSearchProvider implements WebSearchProvider {
  readonly id = PETO_SEARCH_PROVIDER_ID
  readonly title = 'Peto'
  /** Picker description: what this provider suits and what it costs. */
  readonly description = {
    en: 'Searches through Peto Web with Peto’s own model and returns titles, URLs, snippets and summaries. Uses the signed-in Peto account; each search counts as one Peto Agent step.',
    zh: '通过 Peto Web 使用 Peto 自己的模型搜索，返回标题、URL、摘要与概述。使用已登录的 Peto 账号，每次搜索计一步 Peto Agent 额度。',
    ja: 'Peto Web 経由で Peto 自身のモデルを使って検索し、タイトル、URL、スニペット、要約を返します。サインイン中の Peto アカウントを使い、検索 1 回ごとに Peto Agent のステップを 1 つ消費します。',
    es: 'Busca a través de Peto Web con el propio modelo de Peto y devuelve títulos, URL, fragmentos y resúmenes. Usa la cuenta de Peto con sesión iniciada; cada búsqueda cuenta como un paso de Peto Agent.',
    fr: 'Effectue la recherche via Peto Web avec le modèle de Peto et renvoie titres, URL, extraits et résumés. Utilise le compte Peto connecté ; chaque recherche compte pour une étape Peto Agent.',
    de: 'Sucht über Peto Web mit Petos eigenem Modell und liefert Titel, URLs, Ausschnitte und Zusammenfassungen. Verwendet das angemeldete Peto-Konto; jede Suche zählt als ein Peto-Agent-Schritt.',
    ru: 'Ищет через Peto Web собственной моделью Peto и возвращает заголовки, URL, фрагменты и краткие изложения. Использует вошедший аккаунт Peto; каждый поиск расходует один шаг Peto Agent.',
    pt: 'Pesquisa pelo Peto Web com o próprio modelo do Peto e retorna títulos, URLs, trechos e resumos. Usa a conta Peto conectada; cada pesquisa conta como um passo do Peto Agent.',
  }

  /** @param resolveOptions - options for the next search, read once at its entry. */
  constructor(private readonly resolveOptions: () => PetoSearchOptions) {}

  available(): boolean {
    return URL.canParse(this.resolveOptions().baseURL)
  }

  async ready(): Promise<boolean> {
    return await this.resolveOptions().token() !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const token = await options.token()
    signal?.throwIfAborted()
    if (token === undefined) throw new Error('Peto web search needs a signed-in Peto account; guide the user to sign in to Peto.')
    const question = boundedQuestion(options.originalQuestion?.())
    const endpoint = `${options.baseURL}/search`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({
          query: request.query,
          count: Math.min(PETO_SEARCH_COUNT, request.maxResults ?? PETO_SEARCH_COUNT),
          need_content: false,
          ...question === undefined ? {} : { ori_question: question },
        }),
        signal: signal === undefined
          ? AbortSignal.timeout(options.timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      })
    } catch (error: unknown) {
      signal?.throwIfAborted()
      throw new Error(`Peto web search request to ${endpoint} failed: ${String(error)}`, { cause: error })
    }
    if (response.status === 401) {
      await options.rejectToken(token)
      throw new Error('Peto Web rejected the sign-in used for this web search. Guide the user to sign in to Peto again.')
    }
    if (!response.ok) {
      const detail = await errorMessage(response)
      throw new Error(`Peto web search failed (HTTP ${String(response.status)})${detail === undefined ? '' : `: ${detail}`}`)
    }
    return mapPetoSearch(await response.json())
  }
}
