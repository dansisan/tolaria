import { createContext, createElement, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { Settings } from '../types'
import type { ThemeMode } from '../lib/themeMode'
import {
  SYSTEM_UI_LANGUAGE,
  getBrowserLanguagePreferences,
  resolveEffectiveLocale,
  serializeUiLanguagePreference,
  type UiLanguagePreference,
} from '../lib/i18n'
import { DEFAULT_DATE_DISPLAY_FORMAT, normalizeDateDisplayFormat, type DateDisplayFormat } from '../utils/dateDisplay'
import { resolveAllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import { DEFAULT_NOTE_LIST_PREVIEW, resolveNoteListPreview, type NoteListPreview } from '../utils/noteListPreview'
import { DEFAULT_SUGGESTED_RELATIONSHIPS, resolveSuggestedRelationships } from '../utils/suggestedRelationships'
import { useAiAgentPreferences } from './useAiAgentPreferences'
import type { AiAgentsStatus } from '../lib/aiAgents'
import { useDocumentThemeMode } from './useDocumentThemeMode'
import { useTelemetry } from './useTelemetry'
import { useThemeMode } from './useThemeMode'

interface AppPreferencesConfig {
  aiAgentsStatus: AiAgentsStatus
  onToast: (message: string | null) => void
  saveSettings: (settings: Settings) => void | Promise<void>
  settings: Settings
  settingsLoaded: boolean
}

interface AppPreferenceValues {
  dateDisplayFormat: DateDisplayFormat
  noteListPreview: NoteListPreview
  suggestedRelationships: readonly string[]
}

const DEFAULT_APP_PREFERENCES: AppPreferenceValues = {
  dateDisplayFormat: DEFAULT_DATE_DISPLAY_FORMAT,
  noteListPreview: DEFAULT_NOTE_LIST_PREVIEW,
  suggestedRelationships: DEFAULT_SUGGESTED_RELATIONSHIPS,
}

const AppPreferencesContext = createContext<AppPreferenceValues>(DEFAULT_APP_PREFERENCES)

export function AppPreferencesProvider({
  children,
  dateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
  noteListPreview = DEFAULT_NOTE_LIST_PREVIEW,
  suggestedRelationships = DEFAULT_SUGGESTED_RELATIONSHIPS,
}: {
  children: ReactNode
  dateDisplayFormat?: DateDisplayFormat
  noteListPreview?: NoteListPreview
  suggestedRelationships?: readonly string[]
}) {
  const value = useMemo(
    () => ({ dateDisplayFormat, noteListPreview, suggestedRelationships }),
    [dateDisplayFormat, noteListPreview, suggestedRelationships],
  )
  return createElement(AppPreferencesContext.Provider, { value }, children)
}

export function useDateDisplayFormat(): DateDisplayFormat {
  return useContext(AppPreferencesContext).dateDisplayFormat
}

export function useNoteListPreview(): NoteListPreview {
  return useContext(AppPreferencesContext).noteListPreview
}

/**
 * The relationship keys the Inspector offers as ready-to-fill slots, and the
 * vocabulary that routes a Type-schema key to the Relationships panel. Empty
 * when the user cleared the setting: the panel then shows only its
 * "Add relationship" button.
 */
export function useSuggestedRelationships(): readonly string[] {
  return useContext(AppPreferencesContext).suggestedRelationships
}

export function useAppPreferences({
  aiAgentsStatus,
  onToast,
  saveSettings,
  settings,
  settingsLoaded,
}: AppPreferencesConfig) {
  const systemLocale = useMemo(
    () => resolveEffectiveLocale(SYSTEM_UI_LANGUAGE, getBrowserLanguagePreferences()),
    [],
  )
  const appLocale = useMemo(
    () => resolveEffectiveLocale(settings.ui_language, [systemLocale]),
    [settings.ui_language, systemLocale],
  )
  const dateDisplayFormat = useMemo(
    () => normalizeDateDisplayFormat(settings.date_display_format) ?? DEFAULT_DATE_DISPLAY_FORMAT,
    [settings.date_display_format],
  )
  const allNotesFileVisibility = useMemo(
    () => resolveAllNotesFileVisibility(settings),
    [settings],
  )
  const noteListPreview = useMemo(
    () => resolveNoteListPreview(settings),
    [settings],
  )
  const suggestedRelationships = useMemo(
    () => resolveSuggestedRelationships(settings),
    [settings],
  )
  const selectedUiLanguage: UiLanguagePreference = settings.ui_language ?? SYSTEM_UI_LANGUAGE

  useEffect(() => {
    document.documentElement.lang = appLocale
  }, [appLocale])

  useThemeMode(settings.theme_mode, settingsLoaded)
  const documentThemeMode = useDocumentThemeMode()
  const handleToggleThemeMode = useCallback(() => {
    const theme_mode = documentThemeMode === 'dark' ? 'light' : 'dark'
    void saveSettings({ ...settings, theme_mode })
  }, [documentThemeMode, saveSettings, settings])
  const handleSetThemeMode = useCallback((theme_mode: ThemeMode) => {
    if (!settingsLoaded) return
    void saveSettings({ ...settings, theme_mode })
  }, [saveSettings, settings, settingsLoaded])
  const handleSetUiLanguage = useCallback((uiLanguage: UiLanguagePreference) => {
    void saveSettings({ ...settings, ui_language: serializeUiLanguagePreference(uiLanguage) })
  }, [saveSettings, settings])
  const aiAgentPreferences = useAiAgentPreferences({
    settings,
    settingsLoaded,
    saveSettings,
    aiAgentsStatus,
    onToast,
  })

  useTelemetry(settings, settingsLoaded)

  return {
    aiAgentPreferences,
    allNotesFileVisibility,
    appLocale,
    dateDisplayFormat,
    documentThemeMode,
    handleSetThemeMode,
    handleSetUiLanguage,
    handleToggleThemeMode,
    noteListPreview,
    selectedUiLanguage,
    suggestedRelationships,
    systemLocale,
  }
}
