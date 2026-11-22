import { toast } from "sonner";
import readingDefaults from "../../../bin/assets/reading-defaults.json";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Type,
  List,
  Edit,
  BookOpen,
  Trash,
  type NeatIcon,
} from "@neaticons/react";
import { MotionEntry, ActivityIcon } from "@/components/ui/motion-entry";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ReadingBehavior } from "./ReadingBehavior";
import { ReadingFontPicker } from "./ReadingFontPicker";
import { ReadingControlLabel, readingControlPanelSurface, readingControlSurface } from "./ReadingControl";
import { rpc, type Preferences } from "./model";

export type ReadingPreferenceChange =
  | { action: "reading-save"; input: Partial<Preferences["reading"]> }
  | { action: "font-select"; input: { id: string } }
  | { action: "font-remove"; input: { id: string } }
  | { action: "font-import"; input: { name: string; data: string } };

type EmbeddedReading = {
  preferences: Preferences;
  portalContainer: HTMLElement;
  chooseFonts?: () => Promise<ChosenFont[]>;
  change: (request: ReadingPreferenceChange) => Promise<void>;
};
export type ChosenFont = { name: string } & ({ data: string } | { error: string });
const readingSample = ["خواندن باید ساده باشد.", "هر خط جای خودش را دارد."];
const panelAccordionTrigger =
  "-mx-1.5 items-center rounded-sm px-1.5 py-2 text-[13px] leading-5 font-medium text-muted-foreground duration-(--motion-ui) hover:text-foreground hover:no-underline data-[state=open]:text-foreground dark:hover:text-white dark:data-[state=open]:[&>span]:text-white [&>svg]:text-foreground [&>svg]:opacity-65 hover:[&>svg]:opacity-100";
const panelSectionContent = "px-2.5 py-1.5";

function readingErrorMessage(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  return message.replace(/^Error invoking remote method 'rasta:[\w-]+': (?:Error: )?/, "");
}

function Choice({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  portalContainer,
  icon: Icon,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  options: [string, string][];
  disabled: boolean;
  icon: NeatIcon;
  portalContainer?: HTMLElement;
}) {
  const [open, setOpen] = useState(false);
  if (value === null) return <Skeleton className={cn("h-9 w-full rounded-lg", portalContainer && "h-8")} />;
  return (
    <Select
      value={value}
      portalContainer={portalContainer}
      onValueChange={onChange}
      disabled={disabled && !portalContainer}
      open={portalContainer ? open : undefined}
      onOpenChange={(next) => {
        if (!disabled || !next) setOpen(next);
      }}
    >
      <SelectTrigger
        id={id}
        size={portalContainer ? "sm" : "default"}
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={cn(readingControlSurface, portalContainer && readingControlPanelSurface, "*:data-[slot=select-value]:ml-auto")}
      >
        <ReadingControlLabel icon={Icon} label={label} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent portalContainer={portalContainer} align="end" className="w-36 border-0" matchTriggerWidth={false}>
        {options.map(([value, text]) => (
          <SelectItem key={value} value={value}>{text}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function ReadingSettings({
  app,
  disabled,
  embedded,
  onFontInteractionChange,
}: {
  app: { id?: string; name: string };
  disabled: boolean;
  embedded?: EmbeddedReading;
  onFontInteractionChange?: (active: boolean) => void;
}) {
  const [managerPref, setPref] = useState<Preferences | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [family, setFamily] = useState("Vazir");
  const pref = embedded?.preferences ?? managerPref;
  const [loadError, setLoadError] = useState("");
  const portalContainer = embedded?.portalContainer;
  const [section, setSection] = useState("behavior");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Preferences["fonts"][number] | null>(null);
  const [removeError, setRemoveError] = useState("");
  const writing = useRef(false);
  const writeRevision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickingFile = useRef(false);
  const fontPickerButton = useRef<HTMLButtonElement>(null);
  const finishFontInteraction = () => {
    // Keep the host panel open until focus returns from the chooser or confirmation.
    requestAnimationFrame(() => {
      fontPickerButton.current?.focus({ preventScroll: true });
      pickingFile.current = false;
      onFontInteractionChange?.(false);
    });
  };
  useEffect(() => {
    if (portalContainer) return;
    let alive = true;
    setPref(null);
    setLoadError("");
    let pending = false;
    const refresh = async () => {
      if (pending || writing.current || document.hidden) return;
      pending = true;
      const revision = writeRevision.current;
      try {
        const value = await rpc({ action: "preferences", target: app.id });
        if (alive && revision === writeRevision.current) {
          setPref(value);
          setLoadError("");
        }
      } catch (e) {
        if (alive && revision === writeRevision.current)
          setLoadError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [app.id, portalContainer]);
  useEffect(() => {
    if (portalContainer) return;
    let alive = true;
    let loaded: FontFace | undefined;
    if (!pref?.active) {
      setFamily("Vazir");
      return;
    }
    const face = new FontFace(
      "Custom_" + pref.active.id,
      Uint8Array.from(atob(pref.active.data), (character) =>
        character.charCodeAt(0),
      ).buffer,
    );
    void face
      .load()
      .then((font) => {
        if (alive) {
          document.fonts.add(font);
          loaded = font;
          setFamily(font.family);
        }
      })
      .catch(() => {
        if (alive)
          setError("This font could not be previewed. Choose another font.");
      });
    return () => {
      alive = false;
      if (loaded) document.fonts.delete(loaded);
    };
  }, [portalContainer, pref?.active?.id]);
  const change = async (request: ReadingPreferenceChange) => {
    if (embedded) await embedded.change(request);
    else setPref(await rpc({ ...request, target: app.id }));
  };
  const save = async (request: ReadingPreferenceChange) => {
    if (!pref || disabled || writing.current) return;
    if (request.action === "reading-save" &&
        Object.entries(request.input).every(([key, value]) => pref.reading[key as keyof Preferences["reading"]] === value)) return;
    if (request.action === "font-select" && request.input.id === pref.selected) return;
    writing.current = true;
    writeRevision.current++;
    setSaving(true);
    setError("");
    try {
      await change(request);
      if (request.action === "font-remove") {
        setRemoveOpen(false);
        toast.success(`Font removed for ${app.name}`);
      }
      if (
        embedded &&
        (request.action === "font-select" ||
          (request.action === "reading-save" && ("fs" in request.input || "lh" in request.input)))
      ) {
        toast.success(`Saved for ${app.name}`, { id: "rasta-typography-save" });
      }
    } catch (e) {
      const message = readingErrorMessage(e);
      if (embedded) {
        if (request.action === "font-remove") setRemoveOpen(false);
        toast.error(message);
      } else if (request.action === "font-remove") {
        setRemoveError(message);
      } else {
        setError(message);
      }
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };
  const importFonts = async (files: (File | ChosenFont)[]) => {
    if (disabled || writing.current || !files.length) return;
    writing.current = true;
    writeRevision.current++;
    setSaving(true);
    setError("");
    let added = 0;
    const failures: string[] = [];
    try {
      // Each response is a snapshot of this connection's library. Import in
      // sequence so the last successful snapshot includes the whole batch.
      for (const file of files) {
        try {
          let data: string;
          if (file instanceof File) {
            if (!/\.(ttf|otf)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) {
              throw new Error("Choose a valid TTF or OTF font up to 2 MB.");
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 32768) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            }
            data = btoa(binary);
          } else {
            if ("error" in file) throw new Error(file.error);
            data = file.data;
          }
          await change({
            action: "font-import",
            input: { name: file.name, data },
          });
          added++;
        } catch (error) {
          failures.push(`${file.name}: ${readingErrorMessage(error)}`);
        }
      }
      if (failures.length) {
        if (!embedded) setError(failures.join("\n"));
        const message = `${failures.length} ${failures.length === 1 ? "font" : "fonts"} could not be added.`;
        const addedMessage = added ? `${added} ${added === 1 ? "font was" : "fonts were"} added.` : undefined;
        const description = embedded ? (
          <div className="max-h-24 space-y-1 overflow-y-auto [overflow-wrap:anywhere]">
            {addedMessage && <div>{addedMessage}</div>}
            {failures.map((failure, index) => <div key={index}>{failure}</div>)}
          </div>
        ) : addedMessage;
        if (added) {
          toast.warning(message, { description });
        } else {
          toast.error(message, { description });
        }
      } else {
        const message = `${added} ${added === 1 ? "font" : "fonts"} added.`;
        if (embedded) {
          toast.success(`Saved for ${app.name}`, { id: "rasta-typography-save", description: message });
        } else {
          toast.success(message);
        }
      }
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };
  if (!pref && loadError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  const locked = !pref || disabled || saving;
  const chooseFontFiles = async () => {
    if (pickingFile.current || locked) return;
    pickingFile.current = true;
    onFontInteractionChange?.(true);
    if (!embedded?.chooseFonts) {
      fileInput.current?.click();
      return;
    }
    try {
      await importFonts(await embedded.chooseFonts());
    } catch (e) {
      toast.error("Couldn’t open the font picker", { description: readingErrorMessage(e) });
    } finally {
      finishFontInteraction();
    }
  };
  const fonts = [...(pref?.vazirRemoved ? [] : [{ id: "vazir", label: "Vazir" }]), ...(pref?.fonts ?? [])];
  const removalFont = fonts.length > 1 ? fonts.find((font) => font.id === removeTarget?.id) : undefined;
  const replacementFont = pref?.selected === removeTarget?.id ? fonts.find((font) => font.id !== removeTarget?.id) : undefined;
  const fontLabel = fonts.find((font) => font.id === pref?.selected)?.label || "Vazir";
  const behavior = (
    <ReadingBehavior
      compact={!!embedded}
      showHeading={!embedded}
      reading={pref?.reading ?? null}
      disabled={locked}
      onChange={(key, value) =>
        void save({ action: "reading-save", input: { [key]: value } })
      }
    />
  );
  const typography = (
    <div className={embedded ? "space-y-2" : "space-y-6"} aria-busy={!pref || undefined}>
      {!embedded && (error || loadError) && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-line [overflow-wrap:anywhere]">{error || loadError}</AlertDescription>
        </Alert>
      )}
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight">Typography</h3>
          <span
            role="status"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            {!pref ? (
              <Skeleton className="h-3 w-24" />
            ) : saving ? (
              <>
                <ActivityIcon className="size-3" />
                Saving…
              </>
            ) : (
              <>
                <MotionEntry as="span" kind="pop" className="inline-flex">
                  <Check className="size-3 text-emerald-700 dark:text-emerald-300" />
                </MotionEntry>
                Saved for {app.name}
              </>
            )}
          </span>
        </div>
      )}
      <div
        className={cn(
          "grid gap-4",
          !embedded && "min-[700px]:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]",
        )}
      >
        <Card
          className={cn(
            "gap-0 shadow-none",
            embedded ? "bg-transparent p-0" : "overflow-hidden rounded-[22px] bg-(--reading-tray) p-2",
          )}
        >
          <div className={embedded ? "space-y-1" : "space-y-1.5"}>
            <ReadingFontPicker
              label="Font"
              selected={pref?.selected ?? null}
              fonts={fonts}
              onSelect={(id) => void save({ action: "font-select", input: { id } })}
              onRemove={(font) => {
                onFontInteractionChange?.(true);
                setRemoveTarget(font);
                setRemoveError("");
                setRemoveOpen(true);
              }}
              portalContainer={portalContainer}
              triggerRef={fontPickerButton}
              onAdd={chooseFontFiles}
              disabled={locked}
            />
            <Choice
              id="text-size"
              label="Size"
              icon={Edit}
              value={pref?.reading.fs ?? null}
              onChange={(fs) => void save({ action: "reading-save", input: { fs } })}
              portalContainer={portalContainer}
              options={["14", "16", "18"].map((n) => [n, n + " px"])}
              disabled={locked}
            />
            <Choice
              id="line-height"
              label="Spacing"
              icon={List}
              value={pref?.reading.lh ?? null}
              onChange={(lh) => void save({ action: "reading-save", input: { lh } })}
              portalContainer={portalContainer}
              options={[
                ["1.4", "Compact"],
                ["1.6", "Comfortable"],
                ["1.8", "Spacious"],
              ]}
              disabled={locked}
            />
          </div>
        </Card>
        {!embedded && (
          <section
            aria-label="Reading preview"
            className="flex min-w-0 flex-col overflow-hidden rounded-[22px] bg-(--reading-tray) p-1.5"
          >
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-medium">
                <BookOpen
                  aria-hidden
                  className="size-4 text-primary"
                  strokeWidth={1.75}
                />
                Reading preview
              </span>
              {pref ? (
                <Badge
                  variant="outline"
                  title={fontLabel}
                  className="max-w-[45%] rounded-full border-transparent bg-card/70 text-[10px] font-medium text-muted-foreground"
                >
                  <bdi className="block min-w-0 truncate">{fontLabel}</bdi>
                </Badge>
              ) : (
                <Skeleton className="h-5 w-10 rounded-full" />
              )}
            </div>
            {/* Dynamic font data is user content and supplies the preview metrics. */}
            <div
              id="reading-sample"
              lang="fa"
              dir={pref?.reading.isRTL || pref?.reading.forceRTL ? "rtl" : "auto"}
              className="flex min-w-0 flex-1 flex-col justify-center rounded-[16px] bg-card px-4 py-2 shadow-(--shadow-control)"
              style={{
                fontFamily: `"${family}", sans-serif`,
                fontSize: (pref?.reading.fs ?? readingDefaults.fs) + "px",
                lineHeight: pref?.reading.lh ?? readingDefaults.lh,
              }}
            >
              {readingSample.map((line) => <p key={line} className="truncate">{line}</p>)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
  return (
    <div className={embedded ? undefined : "space-y-6"}>
      {!pref && (
        <p className="sr-only" role="status">Loading reading preferences…</p>
      )}
      {embedded ? (
        <>
          <Accordion
            type="single"
            collapsible
            value={section}
            onValueChange={setSection}
            className="rounded-2xl bg-secondary/75 px-2.5"
          >
            <AccordionItem value="behavior" className="border-solid border-border/60 py-1.5">
              <AccordionTrigger className={panelAccordionTrigger}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <BookOpen aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                  Reading
                </span>
              </AccordionTrigger>
              <AccordionContent expanded={section === "behavior"} className={panelSectionContent}>
                {behavior}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="typography" className="py-1.5">
              <AccordionTrigger className={panelAccordionTrigger}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Type aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                  Typography
                </span>
              </AccordionTrigger>
              <AccordionContent expanded={section === "typography"} className={panelSectionContent}>
                {typography}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      ) : (
        <>
          {typography}
          {behavior}
        </>
      )}
      <AlertDialog
        open={removeOpen}
        animateWithKeyboard={!!embedded}
        onOpenChange={(open) => {
          if (!writing.current) setRemoveOpen(open);
        }}
      >
        <AlertDialogContent
          portalContainer={portalContainer}
          className={cn(
            "max-h-[calc(100dvh-2rem)] max-w-sm gap-4 overflow-y-auto data-[size=default]:sm:max-w-sm",
            embedded && "top-(--rasta-panel-center-y) left-(--rasta-panel-center-x) max-h-[calc(var(--rasta-panel-height)-2rem)] w-[calc(var(--rasta-panel-width)-2rem)] max-w-72 p-5 data-[size=default]:sm:max-w-72 data-[state=closed]:slide-out-to-bottom-2",
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            finishFontInteraction();
          }}
        >
          <AlertDialogHeader className="min-w-0 place-items-start text-left">
            <AlertDialogTitle>Remove font?</AlertDialogTitle>
            <AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
              Remove <bdi className="font-medium text-foreground">{removeTarget?.label}</bdi> from {app.name}.
              {replacementFont && <> <bdi>{replacementFont.label}</bdi> will become the reading font.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!embedded && removeError && (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid">
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={locked || !removalFont}
              onClick={(event) => {
                event.preventDefault();
                if (!removalFont) return;
                setRemoveError("");
                void save({ action: "font-remove", input: { id: removalFont.id } });
              }}
            >
              {saving ? <ActivityIcon className="size-4" /> : <Trash className="size-4" />}
              {saving ? "Removing font…" : "Remove font"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!embedded?.chooseFonts && <input
        ref={(input) => {
          fileInput.current = input;
          if (!input) return;
          input.addEventListener("cancel", finishFontInteraction);
          return () => input.removeEventListener("cancel", finishFontInteraction);
        }}
        type="file"
        accept=".ttf,.otf"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importFonts(files).finally(finishFontInteraction);
        }}
      />}
    </div>
  );
}
