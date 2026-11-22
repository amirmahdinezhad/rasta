"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "@neaticons/react";
import { Select as SelectPrimitive } from "radix-ui";

import { menuMotion } from "@/lib/motion";
import { usePopupEntryMotion } from "@/components/ui/popup-motion";

const SelectMotion = React.createContext(false);

function Select({
  open,
  defaultOpen,
  onOpenChange,
  portalContainer,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root> & { portalContainer?: HTMLElement }) {
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen));
  const instant = usePopupEntryMotion(open ?? internalOpen, portalContainer);
  return (
    <SelectMotion.Provider value={instant}>
      <SelectPrimitive.Root
        data-slot="select"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(value) => {
          setInternalOpen(value);
          onOpenChange?.(value);
        }}
        {...props}
      />
    </SelectMotion.Provider>
  );
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn("space-y-1", className)} {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "motion-reduce:transition-none keyboard:transition-none flex w-fit items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm whitespace-nowrap shadow-xs text-foreground/75 transition-[color,border-color,box-shadow] hover:text-foreground duration-(--motion-fast) ease-(--motion-ease-out) outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  side = "bottom",
  sideOffset = 6,
  align = "start",
  portalContainer,
  matchTriggerWidth = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & { portalContainer?: HTMLElement; matchTriggerWidth?: boolean }) {
  return (
    <SelectPrimitive.Portal container={portalContainer}>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          // The shared Select also renders inside an isolated shadow root.
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-(--popover-border) bg-popover text-popover-foreground [box-shadow:var(--shadow-popover)]",
          menuMotion,
          React.useContext(SelectMotion) && "animate-none!",
          className,
        )}
        position={position}
        side={side}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "space-y-1 p-1",
            position === "popper" && "w-full scroll-my-1",
            position === "popper" && matchTriggerWidth && "min-w-[calc(var(--radix-select-trigger-width)-2px)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[calc(var(--radius-lg)-5px)] py-1.5 pr-8 pl-2 text-xs outline-hidden select-none data-[state=checked]:bg-accent/60 data-[state=checked]:font-medium text-popover-foreground/75 transition-[color] duration-(--motion-fast) ease-(--motion-ease-out) keyboard:transition-none data-[highlighted]:text-popover-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
