/**
 * The Yandex search card's staged form over the `web-search-yandex` settings
 * namespace.
 *
 * The key follows the same rule as the DeepSeek card: its literal never rides
 * a response, the card learns only whether one is configured, and writes go
 * through the credentials domain addressed by the section's reference.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the Yandex search provider. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const YANDEX_SEARCH_NS = 'web-search-yandex'

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'YANDEX_SEARCH_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The Yandex search fields this card edits. */
export interface YandexSearchSettings {
  /** Credential reference naming the API key. */
  apiKeyEnv?: string
  /** Yandex Cloud folder id. */
  folderId?: string
  /** 'deferred' (cheap, slow) or 'sync' (fast, pricier). */
  mode?: string
  /** Ranking region id; '225' = вся Россия. */
  region?: string
  /** Passages per document snippet, 1-5. */
  maxPassages?: number
}

/** The credentials Remote methods this card reads and writes through. */
export type YandexSearchCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set'>

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the Yandex search card renders. */
export interface YandexSearchCardState extends CardShell {
  /** Yandex Cloud folder id. */
  folderId: CardFieldState
  /** Search mode: deferred or sync. */
  mode: CardFieldState
  /** Ranking region id. */
  region: CardFieldState
  /** Passages per snippet. */
  maxPassages: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the Yandex search card's slot entry injects. */
export interface YandexSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useYandexSearchCard. */
    yandexSearchCard: SnapshotStore<YandexSearchCardState>
  }
}

/** Bridges the `web-search-yandex` scope and the credentials domain onto the card. */
export class YandexSearchCardController {
  private readonly form: CardForm<YandexSearchSettings>
  private readonly store: SnapshotStore<YandexSearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-yandex` namespace.
   * @param credentials - Remote face used for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<YandexSearchSettings>,
    private readonly credentials: YandexSearchCredentials,
  ) {
    this.form = new CardForm(
      scope,
      [textField('folderId'), textField('mode'), textField('region'), numberField('maxPassages')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): YandexSearchCardState {
    return {
      ...this.form.shell(),
      folderId: this.form.field('folderId'),
      mode: this.form.field('mode'),
      region: this.form.field('region'),
      maxPassages: this.form.field('maxPassages'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   * The answer is stored with the reference it describes so a stale response
   * for a renamed `apiKeyEnv` is dropped rather than published.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<YandexSearchCredentials['describe']>>
    try {
      response = await this.credentials.describe([ref])
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): YandexSearchCardFace {
    return { hooks: { yandexSearchCard: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.credentials.set(refOf(this.scope.getSnapshot()), value)
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<YandexSearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
