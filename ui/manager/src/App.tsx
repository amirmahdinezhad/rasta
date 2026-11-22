import { toast } from "sonner";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Settings,
  Trash,
  ChevronRight,
  Check,
  Moon,
  Sun,
  Monitor,
  Sliders,
  Link,
  Download,
  ArrowDown,
  Hourglass,
  Search,
  Refresh,
  Shield,
  Package,
  AlertCircle,
  LayoutGrid,
} from "@neaticons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircularProgress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
import {
  ActivityIcon,
  MotionEntry,
  SlidingIndicator,
} from "@/components/ui/motion-entry";
import { ReadingSettings } from "./ReadingSettings";
import { ConnectionSettings } from "./ConnectionSettings";
import { RemoveConnections } from "./RemoveConnections";
import { SettingsCard } from "./SettingsCard";
import { appLogo } from "./assets";
import { RastaMark } from "./RastaMark";
import { cn } from "@/lib/utils";
import {
  useManager,
  running,
  newer,
  rpc,
  connectionPhase,
  preparedForFirstInstall,
  type Connection,
} from "./model";
import { PreviewControls } from "./PreviewControls";
const appearanceOptions = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;
type Appearance = (typeof appearanceOptions)[number]["value"];
const appearanceKey = "rasta.appearance";
const systemTheme = "(prefers-color-scheme: dark)";

function Logo({ id, library = false }: { id: string; library?: boolean }) {
  return (
    <span
      data-slot="app-logo"
      className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-muted/80"
    >
      <img
        src={appLogo(id)}
        alt=""
        className={cn("object-contain", library ? "size-9" : "size-8")}
      />
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon-sm"
          className="rounded-full bg-muted/60 text-muted-foreground shadow-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40 dark:bg-muted/60 dark:hover:bg-destructive/10"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export default function App() {
  const manager = useManager();
  const { state, loadingStatus, apps, busy, updates, checking, refresh, perform, check } =
    manager;
  const readingFontInteractionActive = useRef(false);
  const [selected, setSelected] = useState<string | null>(null),
    [collection, setCollection] = useState("all"),
    [tab, setTab] = useState("reading"),
    [settings, setSettings] = useState(false),
    [removal, setRemoval] = useState<Connection | null>(null),
    [coreOffer, setCoreOffer] = useState<string | null>(null),
    [coreTask, setCoreTask] = useState<"check" | "download" | "install" | null>(null);
  const [coreCheckResult, setCoreCheckResult] = useState<"current" | "failed" | null>(null);
  const settingsUpdateButton = useRef<HTMLButtonElement>(null);
  const coreBusy = coreTask !== null;
  const coreUpdate = state.coreUpdate;
  const coreReady = coreUpdate?.phase === "ready" && newer(coreUpdate.version, state.version);
  const coreVerifying = coreTask === "download" && (coreUpdate?.phase === "verifying" || coreReady);
  const coreDownloading = coreTask === "download" && !coreVerifying;
  const coreProgress = coreDownloading && coreUpdate?.phase === "downloading" && typeof coreUpdate.progress === "number"
    ? Math.min(100, Math.max(0, Math.floor(coreUpdate.progress * 100)))
    : null;
  const coreFailed = coreCheckResult === "failed" || (coreCheckResult === null && coreUpdate?.phase === "failed");
  const coreAction = coreTask === "check" ? "Checking…"
    : coreDownloading ? coreProgress === null ? "Downloading…" : `Downloading ${coreProgress}%`
    : coreVerifying ? "Verifying…"
    : coreTask === "install" ? "Updating…"
    : coreReady ? window.rastaPreview ? "Simulate restart and update" : "Restart and update"
    : coreFailed ? "Update failed · Retry"
    : "Check for update";
  const CoreActionIcon = coreTask === "check" ? Refresh
    : coreDownloading ? ArrowDown
    : coreVerifying ? Shield
    : coreTask === "install" ? Package
    : coreReady ? Download
    : coreFailed ? AlertCircle
    : Search;
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const saved = localStorage.getItem(appearanceKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia(systemTheme).matches,
  );
  const dark = appearance === "system" ? systemDark : appearance === "dark";
  const returnFocus = useRef<HTMLElement | null>(null);
  const connectedFilter = useRef<HTMLButtonElement>(null);
  const app = apps.find((a) => a.id === selected);
  const lastApp = useRef<Connection | undefined>(undefined);
  if (app) lastApp.current = app;
  const dialogApp = app || lastApp.current;
  const lastRemoval = useRef<Connection | null>(null);
  if (removal) lastRemoval.current = removal;
  const removalDisplay = removal || lastRemoval.current;
  const lastCoreOffer = useRef<string | null>(null);
  if (coreOffer) lastCoreOffer.current = coreOffer;
  const connectedCount = apps.filter((a) => a.installed).length;
  const visibleApps =
    collection === "connected" ? apps.filter((a) => a.installed) : apps;
  useEffect(() => {
    if (
      collection === "connected" &&
      returnFocus.current &&
      !returnFocus.current.isConnected &&
      document.activeElement === document.body
    ) {
      connectedFilter.current?.focus({ preventScroll: true });
    }
  }, [collection, connectedCount]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("dark") === dark) return;
    // Disable color transitions during the theme swap, including portaled controls.
    const noTransition = "[&_*]:transition-none!";
    root.classList.add(noTransition);
    root.classList.toggle("dark", dark);
    void root.offsetWidth;
    root.classList.remove(noTransition);
  }, [dark]);
  useEffect(() => {
    const media = matchMedia(systemTheme);
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    const key = () => {
      document.documentElement.dataset.keyboard = "true";
    };
    const pointer = () => {
      document.documentElement.dataset.keyboard = "false";
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointerover", pointer, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointerover", pointer, true);
    };
  }, []);
  const open = (a: Connection, connection = false) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setSelected(a.id);
    setTab(connection || a.removalPhase || !a.installed ? "connection" : "reading");
  };
  useEffect(() => {
    window.rastaOpenConnection = (id, view = "connection") => {
      const a = apps.find((a) => a.id === id);
      if (a) {
        setSettings(false);
        open(a, view !== "reading");
      }
    };
    return () => {
      delete window.rastaOpenConnection;
    };
  }, [state]);
  const status = (a: Connection) => {
    if (a.removalPhase) return a.removalPhase === "queued" ? "Removal queued" : "Removing Rasta";
    const current = connectionPhase(a, busy[a.id]);
    if (current?.phase === "failed") return "Action needed";
    if (busy[a.id] || running(a)) {
      if (current?.phase === "ready-to-install") return "Ready for Launch";
      if (current?.phase === "reopening") return "Checking startup";
      if (busy[a.id] === "launch" || (current?.progress === 1 &&
          ["checking", "authorizing-keychain", "quitting", "waiting-for-quit", "installing"].includes(current.phase)))
        return "Installing Rasta";
      return "Preparing Rasta";
    }
    if (a.available === false) return "Rasta not available yet";
    if (a.installed) return newer(updates[a.id], a.version) ? "Update available" : "Rasta installed";
    if (a.recovery) return "Restore reading support";
    if (a.app) return "Rasta not installed";
    return a.error ? "Couldn’t read app details" : "App not installed";
  };
  const begin = (a: Connection) => {
    open(a, true);
    void perform(a, "connect");
  };
  const checkCore = async () => {
    setCoreCheckResult(null);
    setCoreTask("check");
    try {
      const result = await rpc({ action: "core-check" });
      if (newer(result.version, state.version)) setCoreOffer(result.version);
      else {
        setCoreCheckResult("current");
        toast.success("Rasta is up to date.");
      }
    } catch (e) {
      setCoreCheckResult("failed");
      toast.error((e as Error).message);
    } finally {
      setCoreTask(null);
    }
  };
  const runCoreUpdate = async (task: "download" | "install") => {
    setCoreTask(task);
    try {
      await rpc({ action: task === "download" ? "core-update" : "core-install" });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      await refresh();
      setCoreTask(null);
    }
  };
  const restoreFocus = (event: Event, fallback?: HTMLElement | null) => {
    event.preventDefault();
    requestAnimationFrame(() => {
      const trigger = returnFocus.current;
      const target = trigger?.isConnected && !trigger.matches(":disabled")
        ? trigger
        : fallback;
      target?.focus({ preventScroll: true });
    });
  };
  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-dvh bg-surface">
        <MotionEntry
          as="main"
          className="mx-auto flex min-h-dvh max-w-[1100px] flex-col overflow-hidden bg-surface"
        >
          <header
            className={cn(
              "flex items-center justify-between gap-2 border-b border-border/60 px-5 pt-6 pb-4 sm:gap-4 sm:px-7",
              window.webkit?.messageHandlers.rasta && "pt-10",
            )}
          >
            <div aria-label="Rasta Library" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[12px] bg-primary">
                <RastaMark className="size-7 text-primary-foreground" />
              </span>
              <span className="flex items-center gap-2.5">
                <span className="text-lg leading-none font-semibold tracking-tight">Rasta</span>
                {state.version && (
                  <span aria-label="Rasta version" className="text-[11px] leading-none font-medium text-muted-foreground tabular-nums">
                    {state.version}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                aria-label="Rasta settings"
                className="size-9 rounded-full bg-muted p-0 text-muted-foreground shadow-(--shadow-control) duration-(--motion-hover) ease-in-out hover:bg-foreground/15 hover:text-foreground"
                onClick={() => {
                  returnFocus.current = document.activeElement as HTMLElement;
                  setSettings(true);
                }}
              >
                <Settings className="size-[18px] [&_[stroke-width]]:stroke-2" />
              </Button>
            </div>
          </header>
          <div className="flex-1 px-5 py-4 sm:px-7">
            <section className="mb-4 flex items-center justify-between gap-6">
              <div>
                <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
                  Library
                </h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {state.localTest
                    ? window.rastaPreviewControl
                      ? "Simulated local test build. Try installing a test package from Library."
                      : "Local test build. Install signed test packages from Library."
                    : "Install Rasta in your apps and manage reading preferences."}
                </p>
              </div>
            </section>
            {loadingStatus && (
              <p className="sr-only" role="status">Loading app connections…</p>
            )}
            <Tabs
              value={collection}
              onValueChange={setCollection}
              className="gap-4"
            >
              <TabsList
                aria-label="App library"
                className="w-full gap-1 rounded-full group-data-[orientation=horizontal]/tabs:h-11 sm:w-fit"
              >
                <TabsTrigger
                  value="all"
                  className="gap-2 rounded-full px-2 text-xs sm:px-5"
                >
                  <LayoutGrid className="size-3.5" /> All apps{" "}
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 bg-foreground/10 px-1 py-0 text-[10px] text-foreground tabular-nums dark:bg-foreground/15"
                  >
                    {apps.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  ref={connectedFilter}
                  value="connected"
                  disabled={loadingStatus}
                  className="gap-2 rounded-full px-2 text-xs sm:px-5"
                >
                  <Link className="size-3.5" /> Rasta installed{" "}
                  {loadingStatus ? (
                    <Skeleton className="size-5 rounded-full" />
                  ) : (
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-5 bg-foreground/10 px-1 py-0 text-[10px] text-foreground tabular-nums dark:bg-foreground/15"
                    >
                      {connectedCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent key={collection} value={collection} className="m-0" aria-busy={loadingStatus}>
                <h2 className="sr-only">Your apps</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleApps.map((a) => (
                    <Card
                      key={a.id}
                      id={"card-" + a.id}
                      className={cn(
                        "group/card relative isolate gap-0 overflow-hidden rounded-[22px] bg-card px-3.5 py-3 shadow-(--shadow-panel) before:pointer-events-none before:absolute before:inset-0 before:bg-foreground/[0.015] dark:before:bg-foreground/[0.045] before:opacity-0 before:transition-opacity before:duration-(--motion-hover) before:ease-in-out hover:before:opacity-100 has-focus-visible:before:opacity-100 motion-reduce:before:transition-none keyboard:before:transition-none",
                        selected === a.id && "before:opacity-100",
                      )}
                    >
                      <Button
                        id={"tab-" + a.id}
                        variant="ghost"
                        disabled={loadingStatus}
                        onClick={() => open(a, Boolean(busy[a.id]) || running(a))}
                        className="absolute inset-0 z-10 h-full w-full rounded-[22px] p-0 hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-safe:enabled:active:scale-100"
                        aria-label={`Open ${a.name} settings`}
                        aria-haspopup="dialog"
                      >
                        <span className="sr-only">Open {a.name} settings</span>
                      </Button>
                      <CardContent className="pointer-events-none relative z-20 px-1 pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <Logo id={a.id} library />
                            <span className="min-w-0">
                              <span className="block text-[15px] leading-snug font-semibold tracking-tight">
                                {a.name}
                              </span>
                              {loadingStatus ? (
                                <span className="mt-1 flex h-4 items-center">
                                  <Skeleton className="h-2.5 w-24 max-w-full" />
                                </span>
                              ) : (
                                <span
                                  role="status"
                                  className={cn(
                                    "mt-1 flex items-center gap-1.5 text-[11px] font-normal",
                                    a.installed && !a.removalPhase
                                      ? "text-emerald-700 dark:text-emerald-400"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {a.removalPhase === "removing" ? (
                                    <ActivityIcon className="size-3.5 shrink-0" />
                                  ) : a.removalPhase === "queued" ? (
                                    <Hourglass aria-hidden className="size-3.5 shrink-0" />
                                  ) : a.installed ? (
                                    <Check className="size-3.5 shrink-0" />
                                  ) : (
                                    <span className="size-1 shrink-0 rounded-full bg-current" />
                                  )}
                                  <span>{status(a)}</span>
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="pointer-events-auto relative z-20 flex shrink-0 items-center gap-1">
                            {loadingStatus ? (
                              <Skeleton className="h-6 w-10 shrink-0 rounded-full" />
                            ) : a.removalPhase || a.installed || preparedForFirstInstall(a) ? (
                              <IconButton
                                label={`Remove Rasta from ${a.name}`}
                                disabled={Boolean(a.removalPhase || busy[a.id]) || (running(a) && a.operation?.phase !== "ready-to-install")}
                                onClick={(event) => {
                                  returnFocus.current = event.currentTarget;
                                  setRemoval(a);
                                }}
                              >
                                <Trash className="size-4 [&_[stroke-width]]:stroke-2" />
                              </IconButton>
                            ) : a.available !== false && (
                              <Switch
                                aria-label={`Rasta for ${a.name}`}
                                checked={false}
                                disabled={
                                  !a.app || Boolean(busy[a.id]) || running(a)
                                }
                                onCheckedChange={() =>
                                  a.recovery ? open(a, true) : begin(a)
                                }
                              />
                            )}
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="pointer-events-none relative z-20 min-h-8 justify-between rounded-[12px] bg-muted/75 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-[color,background-color] duration-(--motion-hover) ease-in-out group-hover/card:bg-accent group-hover/card:text-foreground group-has-focus-visible/card:bg-accent group-has-focus-visible/card:text-foreground motion-reduce:transition-none keyboard:transition-none">
                        {loadingStatus ? (
                          <>
                            <Skeleton className="h-3 w-28 max-w-full" />
                            <Skeleton className="size-3.5 shrink-0" />
                          </>
                        ) : (
                          <>
                            <span className="flex items-center gap-2">
                              {a.removalPhase ? (
                                <Trash className="size-4" />
                              ) : a.installed ? (
                                <Sliders className="size-4" />
                              ) : (
                                <Link className="size-4" />
                              )}
                              {a.removalPhase
                                ? "View removal"
                                : a.available === false
                                  ? "View support status"
                                  : !busy[a.id] && a.operation?.phase === "ready-to-install"
                                    ? "Continue installation"
                                    : busy[a.id] || running(a)
                                      ? "View installation"
                                      : a.installed
                                        ? "Reading preferences"
                                        : "Install Rasta"}
                            </span>
                            <ChevronRight className="size-3.5 transition-transform duration-(--motion-hover) ease-in-out motion-safe:group-hover/card:translate-x-0.5 motion-reduce:transition-none keyboard:transition-none" />
                          </>
                        )}
                      </CardFooter>
                    </Card>
                  ))}
                </div>
                {visibleApps.length === 0 && (
                  <div className="rounded-[22px] border border-dashed px-6 py-12 text-center">
                    <Link className="mx-auto mb-3 size-6 text-muted-foreground" />
                    <h3 className="text-sm font-medium">
                      Rasta isn’t installed in any apps yet
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose an app in All apps, then select Install Rasta.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4 rounded-full"
                      onClick={() => setCollection("all")}
                    >
                      Browse apps
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </MotionEntry>
        <Dialog
          open={Boolean(app)}
          onOpenChange={(value) => {
            if (!value && !readingFontInteractionActive.current) setSelected(null);
          }}
        >
          <DialogContent
            onInteractOutside={(event) => {
              if (readingFontInteractionActive.current) event.preventDefault();
            }}
            onCloseAutoFocus={(event) =>
              restoreFocus(event, dialogApp && document.getElementById(`tab-${dialogApp.id}`))
            }
            className={cn(
              "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-[28px] p-0 sm:max-w-3xl",
            )}
          >
            <DialogHeader className="shrink-0 px-6 pt-6 pb-6 text-left sm:px-7">
              <div className="flex items-center gap-3 pr-8">
                {dialogApp && <Logo id={dialogApp.id} />}
                <div>
                  <DialogTitle className="text-lg tracking-tight">
                    {dialogApp?.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs">
                    {dialogApp
                      ? status(dialogApp)
                      : "Reading preferences and Rasta installation."}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            {dialogApp && (
              <Tabs
                value={tab}
                onValueChange={setTab}
                className="min-h-0 gap-0"
              >
                <div className="shrink-0 px-6 sm:px-7">
                  <TabsList
                    aria-label="App settings sections"
                    className="w-full gap-1 rounded-full group-data-[orientation=horizontal]/tabs:h-11"
                  >
                    <TabsTrigger
                      value="reading"
                      disabled={
                        !dialogApp.installed || Boolean(dialogApp.removalPhase) || dialogApp.available === false
                      }
                      className="gap-2 rounded-full text-xs"
                    >
                      <Sliders className="size-4" />
                      Reading
                    </TabsTrigger>
                    <TabsTrigger
                      value="connection"
                      className="gap-2 rounded-full text-xs"
                    >
                      <Link className="size-4" />
                      Installation
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full bg-primary",
                          !dialogApp.removalPhase && !running(dialogApp) && "invisible",
                        )}
                      />
                    </TabsTrigger>
                  </TabsList>
                </div>
                <ScrollArea className="grid min-h-0 shrink grid-rows-[minmax(0,1fr)]">
                  <div className="px-6 pt-6 pb-6 sm:px-7 sm:pb-7">
                    <TabsContent value="reading" className="m-0">
                      <ReadingSettings
                        key={dialogApp.id}
                        app={dialogApp}
                        onFontInteractionChange={(active) => {
                          readingFontInteractionActive.current = active;
                        }}
                        disabled={
                          Boolean(dialogApp.removalPhase || busy[dialogApp.id]) || running(dialogApp)
                        }
                      />
                    </TabsContent>
                    <TabsContent value="connection" className="m-0">
                      <ConnectionSettings
                        app={dialogApp}
                        busy={busy[dialogApp.id]}
                        update={updates[dialogApp.id]}
                        checking={checking}
                        perform={perform}
                        check={check}
                        refresh={refresh}
                        openSettings={() => {
                          setSelected(null);
                          setSettings(true);
                        }}
                      />
                    </TabsContent>
                  </div>
                </ScrollArea>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={settings} onOpenChange={setSettings}>
          <DialogContent
            onCloseAutoFocus={restoreFocus}
            aria-describedby={undefined}
            className="max-h-[90dvh] gap-0 overflow-hidden rounded-[28px] p-0 sm:max-w-xl"
          >
            <DialogHeader className="p-6 pb-0 text-left">
              <DialogTitle>Rasta settings</DialogTitle>
            </DialogHeader>
            <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[min(65dvh,430px)]">
              <div className="@container space-y-5 p-6">
                <section
                  className="space-y-3"
                  aria-labelledby="appearance-heading"
                >
                  <h3 id="appearance-heading" className="text-sm font-semibold">
                    Appearance
                  </h3>
                  <div
                    role="group"
                    aria-labelledby="appearance-heading"
                    className="relative isolate grid h-11 grid-cols-3 gap-[3px] rounded-full bg-(--segment-track) p-[3px]"
                  >
                    <SlidingIndicator
                      slot="appearance-indicator"
                      selector='[aria-pressed="true"]'
                    />
                    {appearanceOptions.map(({ value, label, icon: Icon }) => (
                      <Button
                        key={value}
                        variant="segment"
                        aria-pressed={appearance === value}
                        className="relative z-10 h-full gap-1.5 rounded-full px-1.5 text-xs"
                        onClick={() => {
                          if (appearance === value) return;
                          localStorage.setItem(appearanceKey, value);
                          setAppearance(value);
                        }}
                      >
                        <Icon
                          aria-hidden
                          className="size-4 shrink-0"
                          strokeWidth={1.75}
                        />
                        {label}
                      </Button>
                    ))}
                  </div>
                </section>
                <div className="grid auto-rows-fr gap-3 @md:grid-cols-2">
                  <SettingsCard
                    id="rasta-updates-heading"
                    title="Rasta app updates"
                    description="Updates for the Rasta app only."
                  >
                    <Button
                      ref={settingsUpdateButton}
                      variant={coreReady && !coreBusy ? "default" : "outline"}
                      size="sm"
                      className="h-auto min-h-8 w-full whitespace-normal rounded-xl py-1.5 text-xs shadow-none aria-disabled:cursor-default aria-disabled:hover:bg-muted/85"
                      aria-disabled={coreBusy}
                      onClick={() => {
                        if (coreBusy) return;
                        if (coreReady) void runCoreUpdate("install");
                        else void checkCore();
                      }}
                    >
                      <span className="relative grid size-3.5 shrink-0 place-items-center">
                        <CoreActionIcon
                          aria-hidden
                          className={cn(coreDownloading ? "size-2.5" : "size-3.5", coreTask === "check" && "motion-safe:animate-spin")}
                        />
                        {coreDownloading && (
                          <CircularProgress
                            className="pointer-events-none absolute inset-0 size-3.5"
                            aria-hidden
                            value={coreProgress}
                          />
                        )}
                      </span>
                      {coreAction}
                    </Button>
                    <span role="status" className="sr-only">
                      {coreDownloading ? "Downloading…" : coreAction}
                    </span>
                  </SettingsCard>
                  <RemoveConnections
                    apps={apps}
                    removal={state.removal}
                    refresh={refresh}
                    focusAfterRemoval={() => settingsUpdateButton.current?.focus()}
                  />
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={Boolean(removal)}
          onOpenChange={(value) => {
            if (!value) setRemoval(null);
          }}
        >
          <AlertDialogContent
            onCloseAutoFocus={(event) =>
              restoreFocus(event, removalDisplay && document.getElementById(`tab-${removalDisplay.id}`))
            }
            className="rounded-[24px]"
          >
            <AlertDialogHeader>
              <span className="mb-2 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                <Trash className="size-5" />
              </span>
              <AlertDialogTitle>
                Remove Rasta from {removalDisplay?.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {removalDisplay && preparedForFirstInstall(removalDisplay)
                  ? window.rastaPreview
                    ? "This simulation clears the prepared installation and its Rasta settings."
                    : "Rasta will discard the prepared installation and clear its settings for this app."
                  : window.rastaPreview
                    ? `This simulation restores ${removalDisplay?.name} in the demo and leaves it closed.`
                    : `${removalDisplay?.name} will close while Rasta restores its original files and removes its Rasta reading settings. The app will stay closed after removal.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Rasta installed</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive-outline"
                onClick={() => {
                  if (removal) void perform(removal, "remove");
                  setRemoval(null);
                }}
              >
                <Trash className="size-4" strokeWidth={1.75} />
                Remove Rasta
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={Boolean(coreOffer)}
          onOpenChange={(value) => {
            if (!value) setCoreOffer(null);
          }}
        >
          <AlertDialogContent onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsUpdateButton.current?.focus();
          }}>
            <AlertDialogHeader>
              <AlertDialogTitle>Download Rasta {coreOffer || lastCoreOffer.current}?</AlertDialogTitle>
              <AlertDialogDescription>
                {window.rastaPreview ? "Simulated update." : "Install after the download finishes."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void runCoreUpdate("download")}
              >
                <Download className="size-4" />
                {window.rastaPreview ? "Simulate download" : "Download update"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {window.rastaPreviewControl && (
        <PreviewControls
          refresh={refresh}
          clearFailure={manager.clearFailure}
        />
      )}
      <Toaster theme={dark ? "dark" : "light"} />
    </TooltipProvider>
  );
}
