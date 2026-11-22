import { CheckCircle, CloseCircle, InfoCircle, AlertTriangle, Close } from "@neaticons/react";
import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";
import { ActivityIcon } from "./motion-entry";
import { cn } from "@/lib/utils";

export function Toaster({
  theme,
  panel = false,
}: {
  theme: "light" | "dark";
  panel?: boolean;
}) {
  return (
    <Sonner
      theme={theme}
      position="top-center"
      offset={36}
      mobileOffset={{ top: 20 }}
      style={panel ? undefined : { "--width": "min(26rem, calc(100vw - 2rem))" } as CSSProperties}
      dir="ltr"
      gap={8}
      closeButton
      visibleToasts={panel ? 1 : 3}
      className={cn(
        "font-sans! transition-none!",
        panel && "pointer-events-none absolute! inset-x-2! top-2! z-10! w-auto! transform-none!",
      )}
      icons={{
        success: (
          <CheckCircle data-slot="toast-success-icon" className="text-emerald-700 dark:text-emerald-400" />
        ),
        info: <InfoCircle />,
        warning: (
          <AlertTriangle data-slot="toast-warning-icon" className="text-amber-700 dark:text-amber-300" />
        ),
        error: <CloseCircle className="text-destructive" />,
        loading: <ActivityIcon />,
        close: <Close className="size-4" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            "flex w-(--width) items-center gap-3 rounded-xl bg-popover/95 py-2.5 ps-3 pe-2.5 text-popover-foreground backdrop-blur-md transition-[transform,opacity,height]! duration-(--motion-popup)! ease-(--motion-ease-out)! motion-reduce:transition-none! keyboard:transition-none! focus-visible:outline-solid! focus-visible:outline-2! focus-visible:outline-ring! focus-visible:-outline-offset-2 data-[front=false]:data-[expanded=false]:[&>*]:opacity-0 [&>*]:duration-(--motion-fast)! motion-reduce:[&>*]:transition-none! keyboard:[&>*]:transition-none!",
            // Assign the shadow directly because Tailwind's registered shadow properties are unavailable inside the shadow root.
            panel
              ? "pointer-events-auto grid w-full! grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 py-1.5 ps-2.5 pe-10 [box-shadow:var(--shadow-popover)] data-[front=false]:hidden! data-[removed=true]:pointer-events-none! data-[removed=true]:[&>[data-close-button]]:invisible [&>[data-icon]]:col-start-1 [&>[data-icon]]:row-start-1 [&>[data-content]]:col-start-2 [&>[data-content]]:row-start-1 [&>[data-action]]:col-start-2 [&>[data-action]]:row-start-2 [&>[data-action]]:justify-self-start"
              : "shadow-(--shadow-dialog)",
          ),
          icon: "relative grid size-7 shrink-0 place-items-center rounded-full bg-foreground/6 [&_svg]:size-4",
          content: "min-w-0 flex-1",
          title: "text-sm leading-snug font-medium",
          description: "mt-0.5 text-xs leading-snug text-muted-foreground!",
          actionButton:
            "shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground",
          closeButton: cn(
            "order-last grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-transparent! text-muted-foreground! transition-[color,background-color,opacity]! duration-(--motion-fast)! hover:bg-foreground/8! hover:text-foreground! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none! keyboard:transition-none!",
            panel && "absolute inset-y-0 right-1 my-auto",
          ),
        },
      }}
    />
  );
}
