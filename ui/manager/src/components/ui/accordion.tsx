"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "@neaticons/react";
import { Accordion as AccordionPrimitive } from "radix-ui";

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "motion-reduce:transition-none keyboard:transition-none flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-(--motion-fast) ease-(--motion-ease-out) outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="motion-reduce:transition-none keyboard:transition-none pointer-events-none size-4 shrink-0 text-muted-foreground transition-[rotate,opacity] duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:duration-0" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  expanded,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content> & { expanded: boolean }) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      forceMount
      inert={!expanded}
      aria-hidden={!expanded || undefined}
      {...props}
    >
      {/* Radix resets transitions on its content element while measuring. */}
      <div
        data-slot="accordion-transition"
        className={cn(
          "grid text-sm transition-[grid-template-rows,opacity] duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cn("pb-4", className)}>{children}</div>
        </div>
      </div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
