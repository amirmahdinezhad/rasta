import type { NeatIcon } from "@neaticons/react";

export const readingControlSurface =
  "w-full min-w-0 cursor-pointer rounded-lg border-0 bg-card px-2.5 text-xs text-foreground/75 shadow-none transition-[color] hover:bg-card hover:text-foreground data-[state=open]:text-foreground dark:bg-secondary dark:hover:bg-secondary aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export const readingControlPanelSurface = "font-medium text-foreground dark:bg-accent dark:hover:bg-accent [&>[data-slot=reading-control-label]]:font-normal [&>[data-slot=reading-control-label]]:text-muted-foreground";

export function ReadingControlLabel({ icon: Icon, label }: { icon: NeatIcon; label: string }) {
  return (
    <span aria-hidden data-slot="reading-control-label" className="flex w-20 shrink-0 items-center gap-2 text-start font-medium">
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      {label}
    </span>
  );
}
