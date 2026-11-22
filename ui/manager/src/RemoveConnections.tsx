import { useState } from "react";
import { Check, List, AlertCircle, Trash } from "@neaticons/react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ActivityIcon } from "@/components/ui/motion-entry";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { appLogo } from "./assets";
import { preparedForFirstInstall, rpc, type Connection, type ManagerState } from "./model";
import { SettingsCard } from "./SettingsCard";

export function RemoveConnections({ apps, removal, refresh, focusAfterRemoval }: {
  apps: Connection[];
  removal: ManagerState["removal"];
  refresh: () => Promise<unknown>;
  focusAfterRemoval: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ManagerState["removal"]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const connected = apps.filter(app => app.installed || preparedForFirstInstall(app) || app.stalePreparation);
  const activeRemoval = removal?.phase === "removing" ? removal : undefined;
  const current = request && removal && removal.startedAt >= request.startedAt
    ? removal
    : request || activeRemoval;
  const running = pending || current?.phase === "removing";
  const finished = current?.apps.filter(app => app.phase === "complete").length || 0;
  const rows = current?.apps || connected.map(({ id, name }) => ({ id, name, phase: "queued" as const }));
  const simulated = Boolean(window.rastaPreview);

  if (!connected.length && !running && !open) return null;

  const start = async () => {
    if (running || !connected.length) return;
    setError("");
    setPending(true);
    setRequest({
      startedAt: Date.now(),
      phase: "removing",
      apps: connected.map(({ id, name }) => ({ id, name, phase: "queued" })),
    });
    try {
      setRequest(await rpc({ action: "remove-connections" }));
      await refresh();
    } catch (failure) {
      setRequest(undefined);
      setError((failure as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsCard
      id="rasta-removal-heading"
      title="Remove Rasta"
      description="Restore apps and clear Rasta settings."
    >
      <AlertDialog open={open} onOpenChange={value => {
        if (value) {
          setRequest(activeRemoval);
          setError("");
        }
        setOpen(value);
      }}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive-outline" size="sm" className="w-full rounded-xl text-xs shadow-none">
            {running ? (
              <List aria-hidden className="size-3.5" />
            ) : (
              <Trash aria-hidden className="size-3.5 [&_[stroke-width]]:stroke-2" />
            )}
            {running ? "View progress" : "Review removal"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-[440px] gap-4 overflow-y-auto data-[size=default]:sm:max-w-[440px]"
          onCloseAutoFocus={event => {
            if (!connected.length && !running) {
              event.preventDefault();
              focusAfterRemoval();
            }
          }}
        >
          <AlertDialogHeader className="place-items-start text-left">
            <span className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash aria-hidden className="size-5" strokeWidth={1.75} />
            </span>
            <AlertDialogTitle>
              {running ? "Removing Rasta from apps" : current?.phase === "failed" ? "Some connections need attention" : current ? "Connections removed" : "Remove all Rasta connections?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {simulated
                ? "Simulated removal."
                : current?.phase === "complete"
                  ? "Reconnect apps from Library."
                  : "Restore original apps and clear their Rasta settings."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="min-w-0 space-y-2" aria-live="polite">
            {running && (
              <div className="space-y-1.5 px-1">
                <p className="text-xs text-muted-foreground tabular-nums">{finished} of {rows.length} removed</p>
                <Progress value={rows.length ? finished / rows.length * 100 : 0} aria-label="Connections removed" className="h-1.5" />
              </div>
            )}
            <ul className="max-h-[36dvh] divide-y divide-border/60 overflow-y-auto rounded-[16px] bg-muted/55 px-3" aria-label="Removal by app">
              {rows.map(app => (
                <li key={app.id} className="py-2.5 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-card">
                      <img src={appLogo(app.id)} alt="" className="size-8 object-contain" />
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{app.name}</span>
                    {current && (
                      <span className="flex items-center gap-1.5 text-right text-xs text-muted-foreground">
                        {app.phase === "complete" && <Check aria-hidden className="size-3.5 shrink-0" />}
                        {app.phase === "failed" && <AlertCircle aria-hidden className="size-3.5 shrink-0 text-destructive" />}
                        {app.phase === "removing" && <ActivityIcon className="size-3.5 shrink-0" />}
                        {app.phase === "complete" ? "Removed"
                          : app.phase === "failed" ? "Needs attention"
                          : app.phase === "queued" ? "Queued"
                          : "operation" in app && app.operation === "waiting-for-quit" ? "Waiting for app to close"
                          : "Restoring"}
                      </span>
                    )}
                  </div>
                  {"error" in app && app.error && <p className="mt-1 break-words pl-[50px] text-xs text-muted-foreground">{app.error}</p>}
                </li>
              ))}
            </ul>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter className="[&>button]:rounded-full">
            <AlertDialogCancel>{current ? "Close" : "Cancel"}</AlertDialogCancel>
            {connected.length > 0 && !running && current?.phase !== "complete" && (
              <Button
                variant="destructive-outline"
                className="h-auto min-h-9 min-w-0 whitespace-normal sm:flex-1"
                onClick={() => void start()}
              >
                <Trash className="size-4" />
                {simulated ? "Simulate removing all connections" : "Remove all connections"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}
