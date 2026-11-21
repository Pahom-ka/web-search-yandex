# web-search-yandex

Improved web search for the DeepSeek Harness web capability seam (`ctx.web`)
with Yandex support: a `WebSearchProvider` backed by the
[Yandex Search API v2](https://yandex.cloud/docs/services/search-api/)
synchronous XML endpoint, plus a settings UI card.

## What it does

- `POST /search/api/v2/search` with an `Api-Key` header, `FORMAT_XML` responses.
- Each `<doc>` maps to one source: `url`/`title` directly, the first
  `<passage>` (falling back to `<headline>`) as the snippet, `<modtime>`
  normalized to ISO-8601. Documents without a URL are dropped; duplicates are
  deduplicated by URL in document order.
- API errors surface as structured `WEB_PROVIDER_ERROR`; aborts as
  `WEB_ABORTED`; a missing key as `WEB_PROVIDER_CREDENTIAL_MISSING` with an
  actionable message.

## Credential handling (by design)

No secret ever enters configuration files, the settings document, or this
repository:

- The API key is a **credential reference** (`YANDEX_SEARCH_API_KEY`) resolved
  per search through the DSH credentials service, or the launching
  environment.
- The settings card (`client-ui/`) learns only *whether* a key is configured;
  the literal value never rides a response. Writes go through the credentials
  domain.
- `apiKey` in config exists for literal overrides and is marked
  `z.string().role('secret')`.

## Usage

```yaml
- id: web-search-yandex
  name: '@deepseek-ai/dsh-web-search-yandex'
  # all fields optional; folder id falls back to $YANDEX_FOLDER_ID
  config:
    apiKeyEnv: YANDEX_SEARCH_API_KEY
    familyMode: MODERATE   # NONE | MODERATE | STRICT
    numResults: 10
```

## Repository layout

- `src/` — provider plugin (Cordis plugin `web-search-yandex`)
- `tests/` — vitest unit tests (doc/response mapping, provider HTTP behavior)
- `client-ui/` — settings card (`YandexSearchCard.tsx`) and its staged-form
  controller for the DSH web UI
- `patches/` — diffs wiring the card into `ui-settings-plugins` and the agent
  preset rows

## License

MIT
