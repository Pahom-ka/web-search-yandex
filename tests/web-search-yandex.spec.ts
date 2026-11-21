import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mapYandexDoc,
  mapYandexResponse,
  YandexSearchProvider,
  YANDEX_PROVIDER_ID,
} from '../src/provider.ts'

const options = {
  apiKey: 'yandex-key',
  folderId: 'b1gfolder',
  searchURL: 'https://api.yandex.test/search/api/v2/search',
  familyMode: 'MODERATE' as const,
}

/** A representative Search API v2 XML body (grouping wrappers, passages, modtime, entities). */
const FIXTURE_XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearchresponse version="2">
  <response>
    <found>204</found>
    <results>
      <grouping>
        <group attr="d">
          <doc id="hash1">
            <url>https://example.test/docs/a</url>
            <domain>example.test</domain>
            <title><![CDATA[ Заголовок &amp;Lt «A» ]]></title>
            <headline>Первая строка описания</headline>
            <modtime>Tue, 01 Jul 2025 10:00:00 +0300</modtime>
          </doc>
        </group>
        <group attr="d">
          <doc id="hash2">
            <url>https://example.test/docs/b</url>
            <title>Just &amp; ampersand</title>
            <passages><passage>Snippet один</passage><passage>Snippet два</passage></passages>
          </doc>
        </group>
        <group attr="d">
          <doc id="hash3">
            <url>https://example.test/docs/a</url>
            <title>Duplicate URL</title>
          </doc>
        </group>
        <group attr="d">
          <doc id="hash4">
            <title>No URL doc</title>
          </doc>
        </group>
      </grouping>
    </results>
  </response>
</yandexsearchresponse>`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Yandex doc mapping', () => {
  it('maps a doc with headline, entities, and modtime', () => {
    const source = mapYandexDoc(
      '<doc><url>https://a.test</url><title><![CDATA[Заголовок &laquo;A&raquo;]]></title>'
      + '<headline>описание</headline><modtime>Tue, 01 Jul 2025 10:00:00 +0300</modtime></doc>',
    )
    expect(source).toBeDefined()
    expect(source?.url).toBe('https://a.test')
    expect(source?.title).toBe('Заголовок «A»')
    expect(source?.snippet).toBe('описание')
    expect(source?.publishedAt).toBe('2025-07-01T07:00:00.000Z')
  })

  it('prefers the first passage over headline and drops docs without a URL', () => {
    expect(mapYandexDoc('<doc><url>https://b.test</url><headline>h</headline>'
      + '<passages><passage>p1</passage><passage>p2</passage></passages></doc>')?.snippet).toBe('p1')
    expect(mapYandexDoc('<doc><title>no url</title></doc>')).toBeUndefined()
  })
})

describe('Yandex response mapping', () => {
  it('maps docs, deduplicates by URL, keeps document order', () => {
    const result = mapYandexResponse(FIXTURE_XML)
    expect(result.truncated).toBe(false)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.test/docs/a',
      'https://example.test/docs/b',
    ])
    expect(result.sources[1]?.snippet).toBe('Snippet один')
  })

  it('surfaces the API error attribute as a provider error', () => {
    expect(() => mapYandexResponse('<yandexsearchresponse><response error="FOLDER_NOT_FOUND"> </response></yandexsearchresponse>'))
      .toThrow(/FOLDER_NOT_FOUND/)
  })
})

describe('YandexSearchProvider', () => {
  it('is available only with a key source, folder, and parseable URL', () => {
    const provider = new YandexSearchProvider(() => ({ ...options }))
    expect(provider.id).toBe(YANDEX_PROVIDER_ID)
    expect(provider.available()).toBe(true)
    expect(new YandexSearchProvider(() => ({ ...options, apiKey: undefined })).available()).toBe(false)
    expect(new YandexSearchProvider(() => ({ ...options, resolveApiKey: async () => 'k', apiKey: undefined })).available()).toBe(true)
    expect(new YandexSearchProvider(() => ({ ...options, folderId: ' ' })).available()).toBe(false)
    expect(new YandexSearchProvider(() => ({ ...options, searchURL: 'not a url' })).available()).toBe(false)
  })

  it('sends the Api-Key header and maps the XML body', async () => {
    const fetchMock = vi.fn(async () => new Response(FIXTURE_XML, { status: 200, headers: { 'content-type': 'application/xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new YandexSearchProvider(() => ({ ...options })).search({ query: 'тест', maxResults: 5 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.yandex.test/search/api/v2/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Api-Key yandex-key')
    expect(JSON.parse(String(init.body))).toEqual({
      queryText: 'тест',
      folderId: 'b1gfolder',
      responseFormat: 'FORMAT_XML',
      familyMode: 'MODERATE',
      maxDocs: 5,
    })
    expect(result.sources).toHaveLength(2)
  })

  it('surfaces a non-2xx response as a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<error>bad key</error>', { status: 403 })))
    await expect(new YandexSearchProvider(() => ({ ...options })).search({ query: 'x' }))
      .rejects.toThrow(/bad key/)
  })
})
