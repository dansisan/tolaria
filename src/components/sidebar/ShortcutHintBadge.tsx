export function ShortcutHintBadge({ label }: { label: string }) {
  return (
    <span
      data-testid="sidebar-shortcut-hint"
      className="shrink-0 rounded bg-muted px-1 text-[11px] font-medium text-muted-foreground"
    >
      {label}
    </span>
  )
}
