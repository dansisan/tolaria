import { GearSix, X, Sparkle, WarningCircle, PencilSimple } from '@phosphor-icons/react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDragRegion } from '../../hooks/useDragRegion'
import { translate, type AppLocale } from '../../lib/i18n'
import { hasFrontmatterWarnings, type FrontmatterWarnings } from '../../utils/frontmatter'

function FrontmatterWarningsButton({ locale, onOpenRawEditor }: { locale: AppLocale; onOpenRawEditor: () => void }) {
  const label = translate(locale, 'inspector.title.collidingProperties')
  return (
    <ActionTooltip copy={{ label }} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 shrink-0 rounded-md border border-[var(--feedback-warning-border)] bg-[var(--feedback-warning-bg)] p-0 text-[var(--feedback-warning-text)] shadow-none hover:brightness-95"
        aria-label={translate(locale, 'inspector.title.collidingPropertiesAria')}
        data-testid="frontmatter-warnings-button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onOpenRawEditor}
      >
        <WarningCircle size={14} weight="fill" aria-hidden="true" />
      </Button>
    </ActionTooltip>
  )
}

export function InspectorHeader({ collapsed, frontmatterWarnings, locale = 'en', onToggle, onOpenRawEditor }: {
  collapsed: boolean
  frontmatterWarnings?: FrontmatterWarnings
  locale?: AppLocale
  onToggle: () => void
  onOpenRawEditor?: () => void
}) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()
  const propertiesTitle = translate(locale, 'inspector.title.properties')
  const showWarnings = Boolean(frontmatterWarnings && hasFrontmatterWarnings(frontmatterWarnings) && onOpenRawEditor)
  const propertiesIcon = (testId?: string) => (
    <GearSix
      size={16}
      weight="regular"
      className="shrink-0 text-muted-foreground"
      data-testid={testId}
    />
  )
  const toggleLabel = translate(locale, collapsed ? 'inspector.title.propertiesShortcut' : 'inspector.title.closePropertiesShortcut')

  return (
    <div
      ref={dragRegionRef}
      className="flex shrink-0 items-center border-b border-border"
      style={{ height: 52, padding: '6px 12px', gap: 8, cursor: 'default' }}
    >
      {collapsed ? (
        <button type="button"
          className="shrink-0 border-none bg-transparent p-1 text-muted-foreground cursor-pointer hover:text-foreground"
          onClick={onToggle}
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {propertiesIcon('properties-panel-icon')}
        </button>
      ) : (
        <>
          {propertiesIcon('properties-panel-icon')}
          <span className="text-muted-foreground" style={{ fontSize: 13, fontWeight: 600 }}>{propertiesTitle}</span>
          {showWarnings && onOpenRawEditor && (
            <FrontmatterWarningsButton locale={locale} onOpenRawEditor={onOpenRawEditor} />
          )}
          <span className="flex-1" />
          <button type="button"
            className="shrink-0 border-none bg-transparent p-1 text-muted-foreground cursor-pointer hover:text-foreground"
            onClick={onToggle}
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            <X size={16} />
          </button>
        </>
      )}
    </div>
  )
}

export function EmptyInspector({ locale = 'en' }: { locale?: AppLocale }) {
  return <div><p className="m-0 text-[13px] text-muted-foreground">{translate(locale, 'inspector.empty.noNoteSelected')}</p></div>
}

/** The dashed card the inspector uses to offer a one-press repair. */
export function InspectorPrompt({
  action,
  cardClassName,
  children,
  disabled = false,
  icon,
  message,
  onClick,
  testId,
}: {
  action: React.ReactNode
  cardClassName?: string
  children?: React.ReactNode
  disabled?: boolean
  icon: React.ReactNode
  message: React.ReactNode
  onClick: () => void
  testId?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6',
        cardClassName ?? 'border-border',
      )}
      data-testid={testId}
    >
      {icon}
      <p className="m-0 text-center text-[13px] text-muted-foreground">{message}</p>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
        disabled={disabled}
        data-testid={testId ? `${testId}-action` : undefined}
        onClick={onClick}
      >
        {action}
      </button>
      {children}
    </div>
  )
}

export function InitializePropertiesPrompt({ locale = 'en', onClick }: { locale?: AppLocale; onClick: () => void }) {
  return (
    <InspectorPrompt
      icon={<Sparkle size={24} className="text-muted-foreground" />}
      message={translate(locale, 'inspector.empty.noProperties')}
      action={translate(locale, 'inspector.empty.initializeProperties')}
      onClick={onClick}
    />
  )
}

export function InvalidFrontmatterNotice({ locale = 'en', onFix }: { locale?: AppLocale; onFix: () => void }) {
  return (
    <InspectorPrompt
      cardClassName="border-destructive/40 bg-destructive/5"
      icon={<WarningCircle size={24} className="text-destructive" />}
      message={translate(locale, 'inspector.empty.invalidProperties')}
      action={<><PencilSimple size={14} />{translate(locale, 'inspector.empty.fixInEditor')}</>}
      onClick={onFix}
    />
  )
}
