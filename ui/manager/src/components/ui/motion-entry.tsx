import type { ComponentProps } from "react";
import { Sync, type NeatIcon, type NeatIconProps } from "@neaticons/react";
import { cn } from "@/lib/utils";
import {
  contentMotion,
  popMotion,
  trackIndicator,
  useActivity,
  useSlidingIndicator,
} from "@/lib/motion";
import { usePopupEntryMotion } from "./popup-motion";

export function MotionEntry({
  className,
  as: Component = "div",
  kind = "content",
  ...props
}: ComponentProps<"div"> & {
  as?: "div" | "main" | "span";
  kind?: "content" | "pop";
}) {
  const instant = usePopupEntryMotion(true);
  return (
    <Component
      className={cn(
        !instant && (kind === "pop" ? popMotion : contentMotion),
        className,
      )}
      {...props}
    />
  );
}

export function ActivityIcon({
  icon: Icon = Sync,
  spinning = true,
  className,
  ...props
}: NeatIconProps & { icon?: NeatIcon; spinning?: boolean }) {
  const { ref, active } = useActivity<SVGSVGElement>(spinning);
  return (
    <Icon
      ref={ref}
      aria-hidden
      data-motion-active={active}
      className={cn(
        spinning &&
          "animate-spin data-[motion-active=false]:paused motion-reduce:animate-none!",
        className,
      )}
      {...props}
    />
  );
}

export function SlidingIndicator({
  selector,
  slot,
}: {
  selector: string;
  slot: string;
}) {
  const ref = useSlidingIndicator(selector);
  return (
    <span ref={ref} data-slot={slot} aria-hidden className={trackIndicator} />
  );
}
