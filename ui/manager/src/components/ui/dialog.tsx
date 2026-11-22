import * as React from "react";
import { cn } from "@/lib/utils";
import { Close } from "@neaticons/react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";

import { dialogMotion, overlayMotion } from "@/lib/motion";
import { usePopupEntryMotion } from "@/components/ui/popup-motion";

const DialogMotion = React.createContext(false);

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  instant: forceInstant = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { instant?: boolean }) {
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen));
  const instant = usePopupEntryMotion(open ?? internalOpen);
  return (
    <DialogMotion.Provider value={instant || forceInstant}>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(value) => {
          setInternalOpen(value);
          onOpenChange?.(value);
        }}
        {...props}
      />
    </DialogMotion.Provider>
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/35",
        overlayMotion,
        React.useContext(DialogMotion) && "animate-none!",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  portalContainer,
  showOverlay = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  portalContainer?: HTMLElement;
  showOverlay?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal" container={portalContainer}>
      {showOverlay && <DialogOverlay />}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[24px] bg-surface supports-backdrop-filter:bg-surface/85 supports-backdrop-filter:backdrop-blur-xl p-6 shadow-(--shadow-dialog) outline-none",
          dialogMotion,
          React.useContext(DialogMotion) && "animate-none!",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-5 right-5 grid size-8 place-items-center rounded-full bg-muted text-muted-foreground transition-[color,background-color] duration-(--motion-fast) ease-(--motion-ease-out) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none keyboard:transition-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <Close />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
