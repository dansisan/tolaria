import { Article } from '@phosphor-icons/react'
import type { TranslationKey, TranslationValues } from '../lib/i18n'
import type { NoteWidthMode } from '../types'
import { IMAGE_RENAME_MODES, type ImageRenameMode } from '../utils/imageRename'
import type { AllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import { DATE_DISPLAY_FORMATS, type DateDisplayFormat } from '../utils/dateDisplay'
import { NOTE_FONT_SIZE_OPTIONS } from '../utils/noteBodyFontSize'
import { CODE_FONT_SIZE_OPTIONS, normalizeCodeFontSize } from '../utils/codeFontSize'
import {
  SectionHeading,
  SelectControl,
  SettingsGroup,
  SettingsRow,
  SettingsSwitchRow,
} from './SettingsControls'
import { Input } from './ui/input'

type Translate = (key: TranslationKey, values?: TranslationValues) => string

interface VaultContentSettingsSectionProps {
  t: Translate
  dateDisplayFormat: DateDisplayFormat
  setDateDisplayFormat: (value: DateDisplayFormat) => void
  defaultNoteWidth: NoteWidthMode
  setDefaultNoteWidth: (value: NoteWidthMode) => void
  noteBodyFontSize: number
  setNoteBodyFontSize: (value: number) => void
  codeFontSize: number | null
  setCodeFontSize: (value: number | null) => void
  codeLineNumbers: boolean
  setCodeLineNumbers: (value: boolean) => void
  writingSuggestionsEnabled: boolean
  setWritingSuggestionsEnabled: (value: boolean) => void
  imageRenameMode: ImageRenameMode
  setImageRenameMode: (value: ImageRenameMode) => void
  imageRenameCommand: string
  setImageRenameCommand: (value: string) => void
  sidebarTypePluralizationEnabled: boolean
  setSidebarTypePluralizationEnabled: (value: boolean) => void
  initialH1AutoRename: boolean
  setInitialH1AutoRename: (value: boolean) => void
  hideGitignoredFiles: boolean
  setHideGitignoredFiles: (value: boolean) => void
  allNotesFileVisibility: AllNotesFileVisibility
  setAllNotesFileVisibility: (value: AllNotesFileVisibility) => void
  frontmatterCreatedKey: string
  setFrontmatterCreatedKey: (value: string) => void
}

const NOTE_WIDTH_OPTIONS: readonly NoteWidthMode[] = ['normal', 'wide']
const NOTE_WIDTH_LABEL_KEYS: Record<NoteWidthMode, TranslationKey> = {
  normal: 'settings.noteWidth.normal',
  wide: 'settings.noteWidth.wide',
}
const DATE_DISPLAY_LABEL_KEYS: Record<DateDisplayFormat, TranslationKey> = {
  us: 'settings.dateDisplay.us',
  european: 'settings.dateDisplay.european',
  friendly: 'settings.dateDisplay.friendly',
  iso: 'settings.dateDisplay.iso',
}

function buildNoteWidthOptions(t: Translate): Array<{ value: NoteWidthMode; label: string }> {
  return NOTE_WIDTH_OPTIONS.map((value) => ({
    value,
    label: t(Reflect.get(NOTE_WIDTH_LABEL_KEYS, value) as Parameters<Translate>[0]),
  }))
}

function buildNoteFontSizeOptions(): Array<{ value: string; label: string }> {
  return NOTE_FONT_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}px` }))
}

/** "default" keeps the theme sizes (inline code) and the note-body size (code blocks). */
const CODE_FONT_SIZE_DEFAULT_OPTION = 'default'

function buildCodeFontSizeOptions(t: Translate): Array<{ value: string; label: string }> {
  return [
    { value: CODE_FONT_SIZE_DEFAULT_OPTION, label: t('settings.codeFontSize.defaultOption') },
    ...CODE_FONT_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}px` })),
  ]
}

const IMAGE_RENAME_LABEL_KEYS: Record<ImageRenameMode, TranslationKey> = {
  off: 'settings.imageRename.off',
  command: 'settings.imageRename.command',
}

function buildImageRenameOptions(t: Translate): Array<{ value: ImageRenameMode; label: string }> {
  return IMAGE_RENAME_MODES.map((value) => ({
    value,
    label: t(Reflect.get(IMAGE_RENAME_LABEL_KEYS, value) as Parameters<Translate>[0]),
  }))
}

function buildDateDisplayOptions(t: Translate): Array<{ value: DateDisplayFormat; label: string }> {
  return DATE_DISPLAY_FORMATS.map((value) => ({
    value,
    label: t(Reflect.get(DATE_DISPLAY_LABEL_KEYS, value) as Parameters<Translate>[0]),
  }))
}

export function VaultContentSettingsSection({
  t,
  dateDisplayFormat,
  setDateDisplayFormat,
  defaultNoteWidth,
  setDefaultNoteWidth,
  noteBodyFontSize,
  setNoteBodyFontSize,
  codeFontSize,
  setCodeFontSize,
  codeLineNumbers,
  setCodeLineNumbers,
  writingSuggestionsEnabled,
  setWritingSuggestionsEnabled,
  imageRenameMode,
  setImageRenameMode,
  imageRenameCommand,
  setImageRenameCommand,
  sidebarTypePluralizationEnabled,
  setSidebarTypePluralizationEnabled,
  initialH1AutoRename,
  setInitialH1AutoRename,
  hideGitignoredFiles,
  setHideGitignoredFiles,
  allNotesFileVisibility,
  setAllNotesFileVisibility,
  frontmatterCreatedKey,
  setFrontmatterCreatedKey,
}: VaultContentSettingsSectionProps) {
  const updateAllNotesFileVisibility = (patch: Partial<AllNotesFileVisibility>) => {
    setAllNotesFileVisibility({ ...allNotesFileVisibility, ...patch })
  }

  return (
    <>
      <SectionHeading
        icon={<Article size={16} aria-hidden="true" />}
        title={t('settings.vaultContent.title')}
      />

      <SettingsGroup>
        <SettingsRow
          label={t('settings.dateDisplay.default')}
          description={t('settings.dateDisplay.defaultDescription')}
        >
          <SelectControl
            ariaLabel={t('settings.dateDisplay.default')}
            value={dateDisplayFormat}
            onValueChange={(value) => setDateDisplayFormat(value as DateDisplayFormat)}
            options={buildDateDisplayOptions(t)}
            testId="settings-date-display-format"
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.noteWidth.default')}
          description={t('settings.noteWidth.defaultDescription')}
        >
          <SelectControl
            ariaLabel={t('settings.noteWidth.default')}
            value={defaultNoteWidth}
            onValueChange={(value) => setDefaultNoteWidth(value as NoteWidthMode)}
            options={buildNoteWidthOptions(t)}
            testId="settings-default-note-width"
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.noteFontSize.default')}
          description={t('settings.noteFontSize.defaultDescription')}
        >
          <SelectControl
            ariaLabel={t('settings.noteFontSize.default')}
            value={String(noteBodyFontSize)}
            onValueChange={(value) => setNoteBodyFontSize(Number(value))}
            options={buildNoteFontSizeOptions()}
            testId="settings-note-body-font-size"
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.codeFontSize.default')}
          description={t('settings.codeFontSize.defaultDescription')}
        >
          <SelectControl
            ariaLabel={t('settings.codeFontSize.default')}
            value={codeFontSize === null ? CODE_FONT_SIZE_DEFAULT_OPTION : String(codeFontSize)}
            onValueChange={(value) => setCodeFontSize(normalizeCodeFontSize(value))}
            options={buildCodeFontSizeOptions(t)}
            testId="settings-code-font-size"
          />
        </SettingsRow>

        <SettingsSwitchRow
          label={t('settings.codeLineNumbers.label')}
          description={t('settings.codeLineNumbers.description')}
          checked={codeLineNumbers}
          onChange={setCodeLineNumbers}
          testId="settings-code-line-numbers"
        />

        <SettingsSwitchRow
          label={t('settings.writingSuggestions.label')}
          description={t('settings.writingSuggestions.description')}
          checked={writingSuggestionsEnabled}
          onChange={setWritingSuggestionsEnabled}
          testId="settings-writing-suggestions"
        />

        <SettingsRow
          label={t('settings.imageRename.default')}
          description={t('settings.imageRename.defaultDescription')}
        >
          <SelectControl
            ariaLabel={t('settings.imageRename.default')}
            value={imageRenameMode}
            onValueChange={(value) => setImageRenameMode(value as ImageRenameMode)}
            options={buildImageRenameOptions(t)}
            testId="settings-image-rename-mode"
          />
        </SettingsRow>

        {imageRenameMode === 'command' && (
          <SettingsRow
            label={t('settings.imageRename.commandLabel')}
            description={t('settings.imageRename.commandDescription')}
          >
            <Input
              value={imageRenameCommand}
              onChange={(e) => setImageRenameCommand(e.target.value)}
              placeholder="~/bin/name-image.sh"
              data-testid="settings-image-rename-command"
              className="w-64 bg-transparent"
            />
          </SettingsRow>
        )}

        <SettingsSwitchRow
          label={t('settings.sidebarTypePluralization.label')}
          description={t('settings.sidebarTypePluralization.description')}
          checked={sidebarTypePluralizationEnabled}
          onChange={setSidebarTypePluralizationEnabled}
          testId="settings-sidebar-type-pluralization"
        />

        <SettingsSwitchRow
          label={t('settings.titles.autoRename')}
          description={t('settings.titles.autoRenameDescription')}
          checked={initialH1AutoRename}
          onChange={setInitialH1AutoRename}
          testId="settings-initial-h1-auto-rename"
        />

        <SettingsSwitchRow
          label={t('settings.vaultContent.hideGitignored')}
          description={t('settings.vaultContent.hideGitignoredDescription')}
          checked={hideGitignoredFiles}
          onChange={setHideGitignoredFiles}
          testId="settings-hide-gitignored-files"
        />

        <SettingsRow
          label={t('settings.vaultContent.frontmatterCreatedKey')}
          description={t('settings.vaultContent.frontmatterCreatedKeyDescription')}
        >
          <Input
            value={frontmatterCreatedKey}
            onChange={(e) => setFrontmatterCreatedKey(e.target.value)}
            placeholder="created"
            data-testid="settings-frontmatter-created-key"
            className="w-32 bg-transparent"
          />
        </SettingsRow>

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.pdfs')}
          description={t('settings.allNotesVisibility.pdfsDescription')}
          checked={allNotesFileVisibility.pdfs}
          onChange={(checked) => updateAllNotesFileVisibility({ pdfs: checked })}
          testId="settings-all-notes-show-pdfs"
        />

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.images')}
          description={t('settings.allNotesVisibility.imagesDescription')}
          checked={allNotesFileVisibility.images}
          onChange={(checked) => updateAllNotesFileVisibility({ images: checked })}
          testId="settings-all-notes-show-images"
        />

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.unsupported')}
          description={t('settings.allNotesVisibility.unsupportedDescription')}
          checked={allNotesFileVisibility.unsupported}
          onChange={(checked) => updateAllNotesFileVisibility({ unsupported: checked })}
          testId="settings-all-notes-show-unsupported"
        />
      </SettingsGroup>
    </>
  )
}
