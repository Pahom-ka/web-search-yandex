/**
 * The Yandex search provider's card: its folder id, search mode, region, and
 * the API key — which is written through the credentials domain, never into
 * the settings section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { YandexSearchCardFace } from './yandex-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the Yandex search card. */
export type YandexSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<YandexSearchCardFace>

/**
 * Render the Yandex search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function YandexSearchCard(props: YandexSearchCardProps) {
  const { t } = props
  const state = props.useYandexSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="yandexTitle"
      descriptionKey="yandexDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-yandex-search-key"
        label={t('yandexApiKey')}
        hint={t('yandexApiKeyHint')}
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('yandexApiKeySet') : t('yandexApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-yandex-folder"
        label={t('yandexFolderId')}
        hint={t('yandexFolderIdHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.folderId}
        onEdit={(text) => { props.edit('folderId', text) }}
        onReset={() => { props.resetField('folderId') }}
      />
      <ValueField
        id="plugin-config-yandex-mode"
        label={t('yandexMode')}
        hint={t('yandexModeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.mode}
        onEdit={(text) => { props.edit('mode', text) }}
        onReset={() => { props.resetField('mode') }}
      />
      <ValueField
        id="plugin-config-yandex-region"
        label={t('yandexRegion')}
        hint={t('yandexRegionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.region}
        onEdit={(text) => { props.edit('region', text) }}
        onReset={() => { props.resetField('region') }}
      />
      <ValueField
        id="plugin-config-yandex-max-passages"
        label={t('yandexMaxPassages')}
        hint={t('yandexMaxPassagesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxPassages}
        onEdit={(text) => { props.edit('maxPassages', text) }}
        onReset={() => { props.resetField('maxPassages') }}
      />
    </PluginCard>
  )
}
