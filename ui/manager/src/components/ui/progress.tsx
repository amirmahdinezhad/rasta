import * as React from "react";
import { cn } from "@/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";

function Progress({
  className,
  value,
  sampleInterval,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  sampleInterval?: number;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full rounded-full bg-primary transition-transform motion-reduce:transition-none",
          sampleInterval
            ? "duration-(--download-sample-duration) ease-linear"
            : "duration-(--motion-ui) ease-(--motion-ease-out)",
        )}
        style={
          {
            transform: `translateX(-${100 - (value || 0)}%)`,
            "--download-sample-duration": `${sampleInterval || 0}ms`,
          } as React.CSSProperties
        }
      />
    </ProgressPrimitive.Root>
  );
}

function CircularProgress({
  value,
  className,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      {...props}
      data-slot="circular-progress"
      value={value}
      className={cn(
        "relative size-10 rounded-full bg-foreground/15 mask-[radial-gradient(farthest-side,transparent_calc(100%-2px),black_0)]",
        className,
      )}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "absolute inset-0 rounded-full",
          value == null && "motion-safe:animate-spin",
        )}
        style={{
          background: `conic-gradient(currentColor ${value ?? 25}%, transparent 0)`,
        }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress, CircularProgress };
