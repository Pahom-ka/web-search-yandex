/**
 * `YandexSearchProvider`: a `WebSearchProvider` backed by the Yandex Search API v2
 * synchronous XML endpoint (`POST /search/api/v2/search` with an `Api-Key` header).
 * Each `<doc>` maps to one source: `url` and `title` are read directly, the first
 * `<passage>` (falling back to `<headline>`) becomes the snippet, and `<modtime>`
 * becomes `publishedAt` when it parses as the API's `DD MM YYYY HH:mm:ss` shape.
 * `content` is omitted because the API returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-yandex/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Stable id this provider registers under. */
export const YANDEX_PROVIDER_ID = 'yandex'

/** Default endpoint: the Yandex Search API v2 synchronous search operation. */
export const YANDEX_DEFAULT_SEARCH_URL = 'https://api.yandex.ru/search/api/v2/search'

/** Default family filter value sent with every request. */
export const YANDEX_DEFAULT_FAMILY_MODE: YandexFamilyMode = 'MODERATE'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Family-filter values the Search API accepts for `familyMode`. */
export type YandexFamilyMode = 'NONE' | 'MODERATE' | 'STRICT'

/**
 * Resolved provider options (the plugin's `apply` supplies credential,
 * environment, and constant defaults).
 */
export interface YandexSearchProviderOptions {
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Yandex Cloud folder id; sent as `folderId` in every request body. */
  folderId: string
  /** Full search endpoint URL (the operation path is part of it). */
  searchURL: string
  /** Family-filter value sent as `familyMode`. */
  familyMode: YandexFamilyMode
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Yandex search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/**
 * Decode the XML character references and the few named entities Yandex titles
 * and passages carry. Not a general XML decoder: only the portable set.
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&')
}

/** Strip CDATA wrappers and inner tags, then decode entities. */
function xmlText(block: string): string {
  const unwrapped = block.replace(/^\s*<!\[CDATA\[/u, '').replace(/\]\]>\s*$/u, '')
  return decodeHtmlTags(unwrapped).trim()
}

/** Remove tags inside a text node and decode the entities left behind. */
function decodeHtmlTags(text: string): string {
  return decodeXmlEntities(text.replace(/<[^>]+>/g, ''))
}

/** Read one inner element's text from a doc block, or `undefined`. */
function elementText(doc: string, tag: string): string | undefined {
  const match = doc.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'iu'))
  if (match === null) return undefined
  const text = xmlText(match[1] ?? '')
  return text.length > 0 ? text : undefined
}

/** Match `<modtime>` to ISO-8601 — RFC-822 (`Tue, 01 Jul 2025 ...`) or `DD MM YYYY HH:mm:ss` — or keep it verbatim. */
function normalizeModTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const direct = Date.parse(value)
  if (!Number.isNaN(direct)) return new Date(direct).toISOString()
  const dotted = value.match(/^(\d{2})[ .](\d{2})[ .](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (dotted !== null) {
    const composed = Date.parse(`${dotted[3]}-${dotted[2]}-${dotted[1]}T${dotted[4]}:${dotted[5]}:${dotted[6] ?? '00'}Z`)
    if (!Number.isNaN(composed)) return new Date(composed).toISOString()
  }
  return value
}

/**
 * Map one `<doc>` block to a normalized source, or `undefined` when it carries
 * no URL (a doc without a URL cannot be cited, and inventing one would lie).
 */
export function mapYandexDoc(doc: string): WebSearchSource | undefined {
  const url = elementText(doc, 'url')
  if (url === undefined) return undefined
  const title = elementText(doc, 'title')
  const snippet = elementText(doc, 'passage') ?? elementText(doc, 'headline')
  const modtime = normalizeModTime(elementText(doc, 'modtime'))
  return {
    url,
    ...title !== undefined ? { title } : {},
    ...snippet !== undefined ? { snippet } : {},
    ...modtime !== undefined ? { publishedAt: modtime } : {},
  }
}

/**
 * Map a Search API XML response body to a normalized result. Grouping wrappers
 * are ignored: every `<doc>` anywhere in the body is one candidate source, ded
 * uplicated by URL in document order.
 */
export function mapYandexResponse(xml: string): WebSearchResult {
  const error = xml.match(/<response[^>]*\berror="([^"]*)"/iu)
  if (error !== null && (error[1] ?? '').length > 0) {
    throw new WebError(`Yandex Search API error: ${decodeXmlEntities(error[1] ?? '')}`, 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const match of xml.matchAll(/<doc\b[^>]*>([\s\S]*?)<\/doc>/giu)) {
    const source = mapYandexDoc(match[1] ?? '')
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return { sources, truncated: false }
}

/** The Yandex-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class YandexSearchProvider implements WebSearchProvider {
  readonly id = YANDEX_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections.
   */
  constructor(private readonly resolveOptions: () => YandexSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && options.folderId.trim().length > 0
      && URL.canParse(options.searchURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot per operation: a settings write landing inside the credential
    // await must not mix the old section's key with the new section's endpoint.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const body = {
      queryText: request.query,
      folderId: options.folderId,
      responseFormat: 'FORMAT_XML',
      familyMode: options.familyMode,
      ...options.numResults !== undefined || request.maxResults !== undefined
        ? { maxDocs: options.numResults ?? request.maxResults }
        : {},
    }
    let response: Response
    try {
      response = await fetch(options.searchURL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Authorization': `Api-Key ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/xml',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Yandex search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Yandex Search API error (HTTP ${status})`
      try {
        const text = await response.text()
        const detail = xmlText(text.replace(/<[^>]+>/g, ' ')).trim()
        if (detail.length > 0 && detail.length < 500) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const xml = await response.text()
      return mapYandexResponse(xml)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Yandex returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: YandexSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = signal !== undefined && signal.aborted
        ? undefined
        : await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Yandex search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'YANDEX_SEARCH_API_KEY'
    throw new WebError(
      `Yandex search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-yandex config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}
