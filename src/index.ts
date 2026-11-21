/**
 * Yandex Search API-backed `WebSearchProvider` plugin. It contributes to the
 * `ctx.web` registry without owning the service. The API key and folder id are
 * user-editable through the settings namespace `web-search-yandex` (the web
 * settings page renders it); the key value itself is a credential reference
 * resolved per search, never stored in the settings document.
 * @module @deepseek-ai/dsh-web-search-yandex
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  YandexSearchProvider,
  YANDEX_DEFAULT_FAMILY_MODE,
  YANDEX_DEFAULT_SEARCH_URL,
} from './provider.ts'

export {
  YandexSearchProvider,
  YANDEX_DEFAULT_FAMILY_MODE,
  YANDEX_DEFAULT_SEARCH_URL,
  YANDEX_PROVIDER_ID,
  mapYandexDoc,
  mapYandexResponse,
} from './provider.ts'
export type { YandexFamilyMode, YandexSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-yandex'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'YANDEX_SEARCH_API_KEY'
const DEFAULT_FOLDER_ID_ENV = 'YANDEX_FOLDER_ID'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Yandex API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `YANDEX_SEARCH_API_KEY`. */
  apiKeyEnv?: string
  /** Yandex Cloud folder id; defaults to `$YANDEX_FOLDER_ID`. */
  folderId?: string
  /** Full search endpoint. Defaults to the public Search API v2 operation. */
  searchURL?: string
  /** Family filter; defaults to `MODERATE`. */
  familyMode?: 'NONE' | 'MODERATE' | 'STRICT'
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  folderId: z.string(),
  searchURL: z.string().default(YANDEX_DEFAULT_SEARCH_URL),
  familyMode: z.union(['NONE', 'MODERATE', 'STRICT'] as const).default(YANDEX_DEFAULT_FAMILY_MODE),
  numResults: z.number().step(1).min(1),
})

/** Settings namespace carrying this provider's endpoint, folder, and key reference. */
export const WEB_SEARCH_YANDEX_SETTINGS_NAMESPACE = settingsNamespace('web-search-yandex')

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 */
function resolveOptions(ctx: Context, config: Config): import('./provider.ts').YandexSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    folderId: config.folderId ?? launchEnvironmentOf(ctx).get(DEFAULT_FOLDER_ID_ENV)?.value ?? '',
    searchURL: config.searchURL ?? YANDEX_DEFAULT_SEARCH_URL,
    familyMode: config.familyMode ?? YANDEX_DEFAULT_FAMILY_MODE,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }
}

/** Register the Yandex search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_YANDEX_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new YandexSearchProvider(() => resolveOptions(ctx, current())))
}
