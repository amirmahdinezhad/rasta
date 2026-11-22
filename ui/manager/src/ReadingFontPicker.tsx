import { useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Check, ChevronDownIcon, Plus, Trash, Type } from "@neaticons/react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePopupEntryMotion } from "@/components/ui/popup-motion";
import { menuMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Preferences } from "./model";
import { ReadingControlLabel, readingControlPanelSurface, readingControlSurface } from "./ReadingControl";

type Font = Preferences["fonts"][number];
const enabledItems = ':is([role="menuitemradio"], [role="menuitem"]):not([data-disabled])';

function navigateEmbeddedMenu(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(enabledItems));
  const index = items.indexOf(event.target as HTMLElement);
  const last = items.length - 1;
  const next = event.key === "ArrowDown" ? Math.min(index + 1, last)
    : event.key === "ArrowUp" ? (index < 0 ? last : Math.max(index - 1, 0))
    : event.key === "Home" || event.key === "PageUp" ? 0 : last;
  event.preventDefault();
  items[next]?.focus();
}

export function ReadingFontPicker({
  selected, fonts, label, disabled, portalContainer, triggerRef, onSelect, onRemove, onAdd,
}: {
  selected: string | null;
  fonts: Font[];
  label: string;
  disabled: boolean;
  portalContainer?: HTMLElement;
  triggerRef: Ref<HTMLButtonElement>;
  onSelect: (id: string) => void;
  onRemove: (font: Font) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const deferFocus = useRef(false);
  const keyboardOpen = useRef(false);
  const instant = usePopupEntryMotion(open, portalContainer);
  const fontName = fonts.find((font) => font.id === selected)?.label ?? "Vazir";
  if (selected === null) return <Skeleton className={cn("h-9 w-full rounded-lg", portalContainer && "h-8")} />;
  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (next && disabled) return;
        if (next) deferFocus.current = false;
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          id="font-family"
          ref={triggerRef}
          variant="ghost"
          aria-label={label}
          aria-describedby="current-reading-font"
          aria-disabled={disabled || undefined}
          title={fontName}
          onPointerDown={() => { keyboardOpen.current = false; }}
          onKeyDown={(event) => {
            if (["Enter", " ", "ArrowDown"].includes(event.key)) keyboardOpen.current = true;
          }}
          className={cn(
            readingControlSurface,
            // Radix measures this anchor on pointer down, including any press scale.
            "h-9 justify-between gap-2 font-normal motion-safe:enabled:active:scale-100",
            portalContainer && "h-8",
            portalContainer && readingControlPanelSurface,
          )}
        >
          <ReadingControlLabel icon={Type} label={label} />
          <bdi id="current-reading-font" className="min-w-0 flex-1 truncate text-end">{fontName}</bdi>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer}>
        <DropdownMenu.Content
          aria-label={label}
          data-slot="dropdown-menu-content"
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 flex w-[min(16rem,var(--radix-dropdown-menu-trigger-width))] max-w-(--radix-dropdown-menu-content-available-width) max-h-[min(14rem,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground [box-shadow:var(--shadow-popover)]",
            portalContainer && "font-medium",
            menuMotion,
            instant && "animate-none!",
          )}
          onCloseAutoFocus={(event) => {
            if (deferFocus.current) event.preventDefault();
          }}
          // Radix's focus iteration compares document.activeElement, which
          // resolves to the shadow host for every item in the embedded menu.
          onKeyDownCapture={portalContainer ? (event) => {
            keyboardOpen.current = false;
            navigateEmbeddedMenu(event);
          } : undefined}
          onFocusCapture={(event) => {
            if (!portalContainer || !keyboardOpen.current || event.target !== event.currentTarget) return;
            const menu = event.currentTarget;
            requestAnimationFrame(() => {
              if (!keyboardOpen.current || !menu.isConnected) return;
              keyboardOpen.current = false;
              menu.querySelector<HTMLElement>(enabledItems)?.focus();
            });
          }}
        >
          <DropdownMenu.RadioGroup
            value={selected}
            onValueChange={onSelect}
            className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            {fonts.map((font) => (
              <div
                key={font.id}
                role="presentation"
                className={cn("flex min-w-0 items-center gap-0.5 rounded-md", selected === font.id && "bg-accent/60")}
              >
                <DropdownMenu.RadioItem
                  value={font.id}
                  textValue={font.label}
                  title={font.label}
                  disabled={disabled}
                  className={cn(
                    "flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-popover-foreground/75 outline-none transition-[color] duration-(--motion-fast) ease-(--motion-ease-out) data-highlighted:text-popover-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none keyboard:transition-none data-disabled:cursor-default data-disabled:opacity-50",
                    portalContainer && "data-[state=checked]:font-semibold data-[state=checked]:text-popover-foreground",
                  )}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center">
                    <DropdownMenu.ItemIndicator>
                      <Check aria-hidden className="size-3.5" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <bdi className="min-w-0 truncate text-start">{font.label}</bdi>
                </DropdownMenu.RadioItem>
                {fonts.length > 1 && (
                  <DropdownMenu.Item
                    aria-label={`Remove ${font.label}`}
                    title={`Remove ${font.label}`}
                    disabled={disabled}
                    className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none hover:text-destructive focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-highlighted:text-destructive data-disabled:opacity-50"
                    onSelect={() => {
                      deferFocus.current = true;
                      onRemove(font);
                    }}
                  >
                    <Trash aria-hidden className="size-3" />
                  </DropdownMenu.Item>
                )}
              </div>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 shrink-0 border-t border-border/60" />
          <DropdownMenu.Item
            disabled={disabled}
            className="flex min-h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs text-popover-foreground/75 outline-none transition-[color] duration-(--motion-fast) ease-(--motion-ease-out) data-highlighted:text-popover-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none keyboard:transition-none data-disabled:cursor-default data-disabled:opacity-50"
            onSelect={() => {
              deferFocus.current = true;
              onAdd();
            }}
          >
            <Plus aria-hidden className="size-3.5 shrink-0" />
            Add font
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
