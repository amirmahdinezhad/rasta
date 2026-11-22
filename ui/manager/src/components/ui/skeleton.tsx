import { useActivity } from "@/lib/motion";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  const { ref, active } = useActivity<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="skeleton"
      data-motion-active={active}
      className={cn(
        "relative block overflow-hidden rounded-md bg-foreground/10",
        "motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:animate-shimmer motion-safe:after:bg-linear-to-r motion-safe:after:from-transparent motion-safe:after:via-foreground/10 motion-safe:after:to-transparent data-[motion-active=false]:after:paused",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
