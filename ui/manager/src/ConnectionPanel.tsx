import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Refresh } from "@neaticons/react";
import { toast } from "sonner";
import sonnerStyles from "sonner/dist/styles.css?inline";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RastaMark } from "./RastaMark";
import { ReadingSettings, type ChosenFont, type ReadingPreferenceChange } from "./ReadingSettings";
import type { Preferences } from "./model";
import readingDefaults from "../../../bin/assets/reading-defaults.json";
import { ActivityIcon } from "@/components/ui/motion-entry";
import styles from "./index.css?inline";

type Update = {
  available?: boolean;
  release?: { agentVersion?: string };
  releaseError?: string;
};
type State = { preferences: Preferences; update: Update };
type Bridge = {
  name?: string;
  onReady?: () => void;
  check: () => Promise<Update>;
  openManager: () => Promise<unknown>;
  chooseFonts?: () => Promise<ChosenFont[]>;
  changePreferences: (request: ReadingPreferenceChange) => Promise<void>;
};

const visibleToastClose =
  '[data-sonner-toast][data-front=true][data-mounted=true]:not([data-removed=true]) > [data-close-button]';

// The panel shares the manager components, isolated from the host's CSS and React.
export function mount(
  host: HTMLElement,
  trigger: HTMLButtonElement,
  bridge: Bridge,
) {
  const name = bridge.name || "Codex";
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = document.createElement("style");
  // Shadow roots isolate selectors, but rem still resolves against the host document.
  // Fixed design units preserve the manager's compact geometry at any host text scale.
  // Sonner injects its animation styles into the document by default. Include them inside the shadow root as well.
  sheet.textContent = sonnerStyles + "\n" + styles;
  const surface = document.createElement("div");
  surface.dir = "ltr";
  // The panel and its portaled buttons use fill instead of focus rings.
  surface.className = [
    "font-sans text-sm text-foreground antialiased select-none",
    "[&:has(>[data-slot=alert-dialog-overlay])>[data-rasta-panel]]:blur-[3px]",
    "[&_button]:border-0! [&_button]:[box-shadow:none]! [&_button]:outline-none!",
    "[&_button:enabled:not([aria-disabled=true])]:cursor-pointer [&_[role=option]:not([data-disabled])]:cursor-pointer",
    "[&_button]:keyboard-focus:bg-(--panel-control-focus)! [&_button]:keyboard-focus:text-foreground!",
    "[@media(forced-colors:none)]:[&_button[data-slot=dialog-close]]:hover:bg-accent!",
    "[@media(forced-colors:none)]:[&_button[data-slot=dialog-close][data-native-hover]]:bg-accent!",
    "[&_button[data-slot=dialog-close][data-native-hover]]:text-foreground!",
    "[&_button[data-slot=switch][data-state=checked]]:keyboard-focus:bg-[color-mix(in_srgb,var(--primary)_80%,var(--primary-foreground))]!",
    "[&_button[data-slot=switch][data-state=unchecked]]:keyboard-focus:bg-[color-mix(in_srgb,var(--input)_74%,var(--foreground))]!",
    "forced-colors:[&_button]:keyboard-focus:bg-[Highlight]! forced-colors:[&_button]:keyboard-focus:text-[HighlightText]! forced-colors:[&_button]:keyboard-focus:[forced-color-adjust:none]",
  ].join(" ");
  shadow.append(sheet, surface);
  // The confirmation stays beside the panel in the portal so its overlay can blur the panel.
  const measurePanel = (panel: HTMLDivElement | null) => {
    if (!panel) return;
    const measure = () => {
      const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = panel;
      surface.style.setProperty("--rasta-panel-center-x", `${offsetLeft + offsetWidth / 2}px`);
      surface.style.setProperty("--rasta-panel-center-y", `${offsetTop + offsetHeight / 2}px`);
      surface.style.setProperty("--rasta-panel-width", `${offsetWidth}px`);
      surface.style.setProperty("--rasta-panel-height", `${offsetHeight}px`);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", measure);
    };
  };
  // Keep the shared close position in sync with Sonner's toast lifecycle.
  const toastObserver = new MutationObserver(() => {
    const panel = surface.querySelector("[data-rasta-panel]");
    panel?.toggleAttribute("data-toast-close", Boolean(panel.querySelector(visibleToastClose)));
  });
  toastObserver.observe(surface, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-front", "data-mounted", "data-removed"],
  });
  const fixedUnits = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if ("style" in rule) {
        const declarations = (rule as CSSStyleRule).style;
        for (const name of declarations) {
          const value = declarations.getPropertyValue(name);
          if (value.includes("rem"))
            declarations.setProperty(
              name,
              value.replace(
                /(-?(?:\d*\.)?\d+)rem\b/g,
                (_, number) => `${Number(number) * 16}px`,
              ),
              declarations.getPropertyPriority(name),
            );
        }
      }
      if ("cssRules" in rule) fixedUnits((rule as CSSGroupingRule).cssRules);
    }
  };
  if (sheet.sheet) fixedUnits(sheet.sheet.cssRules);
  const keyboard = () => {
    surface.dataset.keyboard = "true";
  };
  const pointer = () => {
    surface.dataset.keyboard = "false";
  };
  surface.addEventListener("keydown", keyboard, true);
  surface.addEventListener("pointerdown", pointer, true);
  const media = matchMedia("(prefers-color-scheme: dark)");
  let publishTheme = (_theme: "light" | "dark") => {};
  const theme = () => {
    const explicit =
      document.documentElement.dataset.theme ||
      document.documentElement.dataset.colorMode;
    const light =
      document.documentElement.classList.contains("light") ||
      explicit === "light";
    const dark =
      document.documentElement.classList.contains("dark") ||
      explicit === "dark";
    surface.classList.toggle("dark", dark || (!light && media.matches));
    publishTheme(surface.classList.contains("dark") ? "dark" : "light");
  };
  const observer = new MutationObserver(theme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-mode"],
  });
  media.addEventListener("change", theme);
  theme();
  let latest: State = {
    preferences: {
      selected: "vazir", fonts: [], active: null,
      reading: readingDefaults,
    },
    update: {},
  };
  let show = () => {};
  let publish = (_value: State) => {};
  let dismiss = (_surfaceChanged = false) => {};
  function Panel() {
    const returnFocus = useRef(true);
    const fontInteractionActive = useRef(false);
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<State>(latest);
    const [checking, setChecking] = useState(false);
    const [opening, setOpening] = useState(false);
    const [appearance, setAppearance] = useState<"light" | "dark">(() =>
      surface.classList.contains("dark") ? "dark" : "light",
    );
    useLayoutEffect(() => {
      trigger.dataset.open = String(open);
      trigger.setAttribute("aria-expanded", String(open));
    }, [open]);
    useLayoutEffect(() => {
      show = () => setOpen((value) => !value);
      dismiss = (surfaceChanged) => {
        if (surfaceChanged) {
          returnFocus.current = false;
          fontInteractionActive.current = false;
        }
        if (surfaceChanged || !fontInteractionActive.current) setOpen(false);
      };
      publish = setState;
      publishTheme = setAppearance;
      setState(latest);
      bridge.onReady?.();
      return () => {
        show = () => {};
        dismiss = () => {};
        publish = () => {};
        publishTheme = () => {};
      };
    }, []);
    const openManager = async () => {
      setOpening(true);
      try {
        await bridge.openManager();
        setOpen(false);
      } catch {
        toast.error(
          `Couldn’t open Rasta. Open it from Applications and select ${name}.`,
        );
      } finally {
        setOpening(false);
      }
    };
    const refresh = async () => {
      if (checking || opening) return;
      setChecking(true);
      try {
        const update = await bridge.check();
        if (update.releaseError) throw Error(update.releaseError);
        if (update.available && update.release) {
          toast.info(
            `Rasta ${update.release.agentVersion || "update"} is available`,
            {
              id: "rasta-update-check",
              action: {
                label: "Open Rasta",
                onClick: () => void openManager(),
              },
            },
          );
        } else {
          toast.success("Rasta is up to date", { id: "rasta-update-check" });
        }
      } catch {
        toast.error("Couldn’t check for Rasta updates", {
          id: "rasta-update-check",
          description: "Check your internet connection, then select Refresh.",
        });
      } finally {
        setChecking(false);
      }
    };
    return (
      <>
        <Dialog
          modal={false}
          instant={trigger.dataset.keyboard === "true"}
          open={open}
          onOpenChange={(value) => {
            if (!value && fontInteractionActive.current) return;
            setOpen(value);
            trigger.dataset.open = String(value);
            trigger.setAttribute("aria-expanded", String(value));
          }}
        >
          <DialogContent
            ref={measurePanel}
            portalContainer={surface}
            showOverlay={false}
            data-rasta-panel=""
            className="top-auto right-4 bottom-14 left-auto flex max-h-[calc(100dvh-5rem)] w-[calc(100vw-2rem)] max-w-80 translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-3xl bg-popover p-0 [box-shadow:var(--shadow-dialog)] supports-backdrop-filter:bg-popover/98 [&>[data-slot=dialog-close]]:top-3 [&>[data-slot=dialog-close]]:right-3 data-[toast-close]:[&>[data-slot=dialog-close]]:invisible"
            onOpenAutoFocus={(event) => {
              returnFocus.current = true;
              surface.dataset.keyboard = String(trigger.dataset.keyboard === "true");
              event.preventDefault();
              requestAnimationFrame(() => {
                const panel = surface.querySelector<HTMLElement>("[data-rasta-panel]");
                const target = panel?.querySelector(visibleToastClose)
                  ? panel
                  : panel?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
                target?.focus({ preventScroll: true });
              });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (returnFocus.current) trigger.focus({ preventScroll: true });
            }}
            onInteractOutside={(event) => {
              if (fontInteractionActive.current) {
                event.preventDefault();
                return;
              }
              const path = event.detail.originalEvent.composedPath();
              // The host document can see a retargeted focus event from the shadow root.
              if (path.includes(trigger) || path.includes(surface))
                event.preventDefault();
              else returnFocus.current = false;
            }}
          >
            <div className="flex min-h-14 shrink-0 items-center gap-1 py-3 pr-14 pl-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-primary text-primary-foreground">
                <RastaMark className="size-5" />
              </span>
              <DialogTitle className="text-base">Rasta</DialogTitle>
              <DialogDescription className="sr-only">
                Reading settings and Rasta updates
              </DialogDescription>
            </div>
            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-3 [overflow-wrap:anywhere]">
              <ReadingSettings
                app={{ name }}
                disabled={false}
                onFontInteractionChange={(active) => {
                  fontInteractionActive.current = active;
                }}
                embedded={{
                  preferences: state.preferences,
                  change: bridge.changePreferences,
                  chooseFonts: bridge.chooseFonts,
                  portalContainer: surface,
                }}
              />
              <div className="mx-2.5 mt-1 flex items-center justify-between gap-2 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {state.update.available
                    ? `Rasta ${state.update.release?.agentVersion || "update"} available`
                    : "Rasta updates"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-disabled={checking || opening}
                  aria-busy={checking}
                  onClick={() => void refresh()}
                  className="shrink-0 rounded-sm bg-secondary/70 px-2 text-xs hover:bg-accent aria-disabled:opacity-50"
                >
                  <ActivityIcon
                    icon={Refresh}
                    spinning={checking}
                    className="size-4"
                  />
                  {checking ? "Checking…" : "Refresh"}
                </Button>
              </div>
            </div>
            <Toaster theme={appearance} panel />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  const root = createRoot(surface);
  root.render(<Panel />);
  return {
    toggle: () => {
      show();
    },
    close: (surfaceChanged = false) => dismiss(surfaceChanged),
    update: (value: State) => {
      latest = value;
      publish(value);
      trigger.dataset.active = String(value.preferences.reading.isRTL);
    },
    dispose: () => {
      toastObserver.disconnect();
      observer.disconnect();
      media.removeEventListener("change", theme);
      surface.removeEventListener("keydown", keyboard, true);
      surface.removeEventListener("pointerdown", pointer, true);
      root.unmount();
    },
  };
}
