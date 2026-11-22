import { useId } from "react";
import { AlignRight, ArrowLeft, Command } from "@neaticons/react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ReadingBehaviorValues = {
  isRTL: boolean;
  forceRTL: boolean;
  fixAtSign: boolean;
};
export type ReadingBehaviorKey = keyof ReadingBehaviorValues;

export function ReadingBehavior({
  reading,
  onChange,
  disabled,
  compact = false,
  showHeading = true,
}: {
  reading: ReadingBehaviorValues | null;
  onChange: (key: ReadingBehaviorKey, value: boolean) => void;
  disabled: boolean;
  compact?: boolean;
  showHeading?: boolean;
}) {
  const heading = useId();
  const headingLabel = compact ? "Reading" : "Reading behavior";
  const behaviors = [
    {
      key: "isRTL",
      title: compact ? "Enable RTL" : "Right-to-left reading",
      description: compact ? "Auto-detect text direction." : "Detect paragraph direction.",
      icon: ArrowLeft,
    },
    {
      key: "forceRTL",
      title: "Enable force RTL",
      description: compact ? "RTL for English too." : "Use RTL for English too.",
      icon: AlignRight,
    },
    {
      key: "fixAtSign",
      title: "Type @ with Shift+2",
      description: compact ? "Persian keyboards." : "Supports Persian keyboards.",
      icon: Command,
    },
  ] as const;
  return (
    <section aria-label={showHeading ? headingLabel : undefined} aria-busy={!reading || undefined} className="space-y-3">
      {showHeading && <h3 className="text-sm font-semibold tracking-tight">{headingLabel}</h3>}
      <Card
        className={
          compact
            ? "gap-0 bg-transparent p-0 shadow-none"
            : "divide-y divide-border/60 gap-0 rounded-[22px] bg-card p-0 shadow-(--shadow-panel)"
        }
      >
        {behaviors.map(({ key, title, description, icon: Icon }) => {
          const requiresRTL = key !== "isRTL" && reading?.isRTL === false;
          const controlDisabled = disabled || requiresRTL;
          return (
            <div
              key={key}
              className={cn(
                compact
                  ? "relative flex items-center gap-2 py-2"
                  : "flex items-center gap-3 px-4 py-3.5",
                compact && (controlDisabled ? "cursor-not-allowed" : "cursor-pointer"),
              )}
            >
              <span className={cn(
                "grid shrink-0 place-items-center text-muted-foreground",
                compact ? "size-4" : "size-8 rounded-lg bg-muted",
              )}>
                <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <div className={cn("min-w-0 flex-1", compact ? "space-y-0.5" : "space-y-1")}>
                <Label
                  asChild={!reading}
                  htmlFor={reading ? heading + "-" + key : undefined}
                  className={
                    compact ? "[cursor:inherit] text-xs leading-snug after:absolute after:inset-0 after:content-['']" : "text-sm leading-snug"
                  }
                >
                  <span>{title}</span>
                </Label>
                <p id={heading + "-help-" + key} className="text-xs leading-snug text-muted-foreground">
                  {description}
                </p>
              </div>
              {reading ? (
                <Switch
                  id={heading + "-" + key}
                  aria-describedby={heading + "-help-" + key}
                  checked={reading[key]}
                  disabled={requiresRTL || (disabled && !compact)}
                  aria-disabled={controlDisabled || undefined}
                  onClick={compact ? event => event.currentTarget.focus({ preventScroll: true }) : undefined}
                  onCheckedChange={(value) => { if (!controlDisabled) onChange(key, value); }}
                  className={cn("aria-disabled:cursor-not-allowed aria-disabled:opacity-50", compact && "z-10")}
                />
              ) : <Skeleton className="h-6 w-10 shrink-0 rounded-full" />}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
