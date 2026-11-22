"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { usePopupEntryMotion } from "./popup-motion";
const TooltipMotion = React.createContext(false);

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [internal, setInternal] = React.useState(Boolean(defaultOpen));
  const isOpen = open ?? internal;
  const instant = usePopupEntryMotion(isOpen);
  return (
    <TooltipMotion.Provider value={instant}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={isOpen}
        onOpenChange={(next) => {
          setInternal(next);
          onOpenChange?.(next);
        }}
        {...props}
      />
    </TooltipMotion.Provider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-98 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--motion-fast) ease-(--motion-ease-out) motion-reduce:animate-none!",
          // Keep the positioned wrapper out of hit testing while Radix tracks the pointer by geometry.
          "[[data-radix-popper-content-wrapper]:has(>&)]:pointer-events-none",
          React.useContext(TooltipMotion) && "animate-none!",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
