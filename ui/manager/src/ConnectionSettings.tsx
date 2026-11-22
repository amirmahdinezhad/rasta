import {
  Check,
  Download,
  Shield,
  Package,
  ExternalLink,
  AlertCircle,
  Activity,
  Archive,
  CloseCircle,
  Hourglass,
  Search,
  Undo,
  Refresh,
  type NeatIcon,
} from "@neaticons/react";
import { MotionEntry, ActivityIcon } from "@/components/ui/motion-entry";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  isRemoval,
  running,
  newer,
  connectionPhase,
  type Connection,
} from "./model";
import { installationIssue } from "./copy";

const installStages: Partial<Record<string, number>> = {
  checking: 0,
  downloading: 0,
  "downloading-agent": 0,
  "downloading-app": 0,
  verifying: 1,
  starting: 2,
  preparing: 2,
  "ready-to-install": 2,
  "authorizing-keychain": 3,
  quitting: 3,
  "waiting-for-quit": 3,
  installing: 3,
  reopening: 3,
  complete: 4,
};

const preparationMessages = {
  "verifying-app": ["Verifying app…", "Checking the signature of your installed app."],
  "preparing-files": ["Preparing files…", "Preparing a separate copy of your app with Rasta."],
  "signing-app": ["Signing app copy…", "Signing the prepared app copy for macOS."],
  "verifying-copy": ["Verifying app copy…", "Checking the signed app copy before Launch."],
} as const;

export function ConnectionSettings({
  app,
  busy,
  update,
  checking,
  perform,
  check,
  refresh,
  openSettings,
}: {
  app: Connection;
  busy?: string;
  update?: string;
  checking: boolean;
  perform: (app: Connection, action: string) => Promise<void>;
  check: (id?: string) => Promise<void>;
  refresh: () => Promise<unknown>;
  openSettings: () => void;
}) {
  const current = connectionPhase(app, busy);
  const restoring = isRemoval(current);
  const launchCheck = current?.phase === "checking" && current.progress === 1 && Boolean(current.id);
  const legacyPreparation = current?.phase === "checking" && current.id && !launchCheck && !restoring;
  const phase = legacyPreparation ? "preparing" : current?.phase || "idle";
  const ready = phase === "ready-to-install",
    failed = phase === "failed",
    complete = phase === "complete",
    queued = phase === "queued";
  const isWorking = Boolean(app.removalPhase || busy) || running(app);
  const issue = failed ? installationIssue(app, current!) : null;
  const offered =
    failed &&
    issue?.action === "check" &&
    newer(update, current?.checkedVersion || app.cachedVersion || app.version);
  const preparation = phase === "preparing" && current?.preparationStep
    ? preparationMessages[current.preparationStep]
    : undefined;
  const percent = current?.total && current.downloaded !== undefined
    ? Math.round((current.downloaded / current.total) * 100)
    : null;
  const downloadActivity = [percent === null ? "Downloading…" : `Downloading ${percent}%`, Download] as const;
  const activities: Partial<Record<string, readonly [string, NeatIcon]>> = {
    queued: ["Waiting in queue", Hourglass],
    starting: [restoring ? "Removing Rasta…" : "Preparing…", Package],
    checking: [launchCheck ? "Checking installation…" : "Checking…", Search],
    downloading: downloadActivity,
    "downloading-agent": downloadActivity,
    "downloading-app": downloadActivity,
    verifying: ["Verifying…", Shield],
    quitting: [`Closing ${app.name}…`, CloseCircle],
    "waiting-for-quit": [`Waiting for ${app.name} to close…`, Hourglass],
    "authorizing-keychain": ["Waiting for macOS…", Shield],
    installing: restoring ? ["Restoring…", Undo] : ["Installing…", Archive],
    reopening: ["Checking startup…", Activity],
  };
  const [activityLabel, PhaseIcon] = activities[phase] ?? [preparation?.[0] || "Preparing…", Package];
  const hostVersion = app.hostVersion && (
    <span className="text-xs text-muted-foreground tabular-nums">
      {app.name} version <span className="font-medium text-foreground">{app.hostVersion}</span>
    </span>
  );
  const stage = restoring
    ? phase === "complete"
      ? 3
      : queued
        ? -1
        : phase === "installing"
          ? 1
          : 0
    : launchCheck
      ? 3
      : (installStages[phase] ?? (phase === "idle" && app.installed ? 4 : -1));
  const steps = restoring
    ? ([
        ["Close app", "Wait for the app to close.", CloseCircle],
        ["Restore", "Put the original app files back.", Undo],
        ["Complete", "Delete this app’s Rasta settings.", Check],
      ] as const)
    : ([
        ["Package", "Find Rasta for your app version.", stage === 0 ? PhaseIcon : Search],
        ["Verify", "Check the package’s signature and files.", Shield],
        ["Prepare", "Check support and prepare app files.", Package],
        ["Install", "Choose Launch to install and reopen.", Archive],
      ] as const);
  const simulated = Boolean(window.rastaPreviewControl);
  const usesKeychain = ["t3", "claude", "zcode"].includes(app.id);
  const headings: Record<string, string> = {
    queued: "Removal queued",
    checking: restoring ? `Removing Rasta from ${app.name}` : launchCheck ? `Checking installation for ${app.name}` : `Finding Rasta for ${app.name}`,
    downloading: `Downloading Rasta for ${app.name}`,
    "downloading-agent": `Downloading Rasta for ${app.name}`,
    "downloading-app": `Downloading ${app.name}`,
    verifying: "Verifying the Rasta package",
    preparing: `Preparing Rasta for ${app.name}`,
    starting: restoring ? `Removing Rasta from ${app.name}` : `Preparing Rasta for ${app.name}`,
    "ready-to-install": "Ready to install — choose Launch",
    "authorizing-keychain": "Authorize Keychain access",
    quitting: `Closing ${app.name}`,
    "waiting-for-quit": `Waiting for ${app.name}`,
    installing: restoring
      ? "Restoring the original app"
      : `Installing Rasta for ${app.name}`,
    reopening: `Checking Rasta in ${app.name}`,
    complete: restoring
      ? `Rasta removed from ${app.name}`
      : `Rasta is installed in ${app.name}`,
    failed: offered
      ? "A newer Rasta package is available"
      : issue?.title || "Installation did not finish",
    cancelled: "Installation preparation cancelled",
  };
  if (app.available === false)
    return (
      <Alert>
        <AlertCircle className="size-4" />
        <AlertTitle>Rasta isn’t available for {app.name} yet</AlertTitle>
        <AlertDescription>
          Rasta support for this app has not been released. You can keep using
          the app without Rasta.
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-[22px] bg-muted/65 p-1.5">
        <ol
          aria-label={restoring ? "Removal stages" : "Installation stages"}
          className={cn("grid px-1 pt-3 pb-2 sm:px-3", restoring ? "grid-cols-3" : "grid-cols-4")}
        >
          {steps.map(([title, description, Icon], i) => (
            <li
              key={title}
              aria-current={i === stage ? "step" : undefined}
              className="relative flex min-w-0 flex-col items-center gap-2 px-0.5 sm:px-1.5"
            >
              <span
                className={cn(
                  "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-card shadow-(--shadow-control) transition-[color,background-color,border-color] duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:transition-none keyboard:transition-none",
                  i < stage
                    ? "border-primary bg-primary text-primary-foreground"
                    : i === stage
                      ? "border-primary bg-accent text-primary"
                      : "text-muted-foreground",
                )}
              >
                {i < stage ? (
                  <MotionEntry as="span" kind="pop" className="inline-flex">
                    <Check className="size-4" />
                  </MotionEntry>
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <div className="text-center">
                <p
                  className={cn(
                    "text-xs font-medium",
                    i === stage ? "text-primary" : "text-foreground",
                  )}
                >
                  {title}
                </p>
                <p className="mt-1 hidden max-w-32 text-[11px] leading-relaxed text-muted-foreground sm:block">
                  {description}
                </p>
              </div>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  data-slot="connection-stage-line"
                  className="absolute top-[15px] left-1/2 h-0.5 w-full overflow-hidden bg-border"
                >
                  <span
                    data-slot="connection-stage-fill"
                    className={cn(
                      "absolute inset-0 origin-left bg-primary transition-transform duration-(--motion-popup) ease-(--motion-ease-out) motion-reduce:transition-none keyboard:transition-none",
                      i < stage ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
        <section
          className="flex min-w-0 flex-col rounded-[16px] bg-card p-5 sm:p-6"
          aria-label={restoring ? "Removal status" : "Installation status"}
        >
          <div className="mb-5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Rasta for {app.name}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {ready
                ? "Prepared"
                : failed
                  ? "Action needed"
                  : isWorking && !complete
                    ? "In progress"
                    : app.installed
                      ? "Installed"
                      : "Not installed"}
            </Badge>
          </div>
          <MotionEntry key={phase} className="min-h-40 min-[480px]:min-h-28 sm:min-h-[5.5rem]">
            <h3 className="text-xl font-semibold tracking-tight">
              {headings[phase] ||
                (app.installed
                  ? `Rasta is installed in ${app.name}`
                  : !app.app
                    ? app.error
                      ? `Couldn’t read ${app.name} details`
                      : `Install ${app.name} first`
                    : app.recovery
                      ? "Restore reading support"
                      : `Install Rasta for ${app.name}`)}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {ready
                ? simulated
                  ? `Simulation: choose Simulate Launch to finish the demo installation. Your installed apps are not changed.`
                  : `Choose Launch ${app.name} to close the app, install Rasta and reopen it. Save any work you need before continuing.${usesKeychain ? " macOS may ask you to authorize Keychain access for this installation." : ""}`
                : phase === "authorizing-keychain"
                  ? simulated
                    ? "Simulating the macOS authorization for this app."
                    : `Approve the macOS request if prompted. This gives the prepared copy of ${app.name} access to its existing Keychain item.`
                : phase === "reopening" && !restoring
                  ? `Waiting for ${app.name} to confirm that Rasta reading support has started.`
                  : phase === "waiting-for-quit"
                    ? restoring
                      ? `Wait for ${app.name} to close so Rasta can restore its original files.`
                      : simulated
                        ? `Simulating ${app.name} closing before installation.`
                        : app.id === "codex"
                          ? "If Codex stays open, switch to Codex and press Command-Q. Rasta will reopen it after installation."
                          : `Wait for ${app.name} to close. Rasta will reopen it when finished.`
                  : failed
                    ? offered
                      ? `Download Rasta ${update} to check support for ${app.name} ${app.hostVersion || ""}. Installation still requires Launch.`
                      : issue?.description
                    : complete && restoring
                      ? `The original ${app.name} files have been restored and this app’s Rasta settings removed.`
                      : restoring
                        ? queued
                          ? "Removal will start when the previous connection finishes."
                          : `Rasta will restore ${app.name}’s original files and remove its Rasta settings.`
                      : !app.app
                        ? app.error
                          ? `Rasta could not read the installed app. Refresh the app list to check its status.`
                          : `Install ${app.name} on this Mac, then refresh the app list.`
                        : phase === "cancelled"
                          ? "Preparation stopped before installation. Choose Prepare Rasta when you are ready."
                            : app.installed && (!isWorking || complete)
                            ? "Open the Reading tab to change your font, text size and reading direction."
                            : launchCheck
                              ? `Checking that ${app.name} still matches the prepared installation.`
                              : phase === "checking"
                              ? busy === "repair" || busy === "recover"
                                ? "Checking which Rasta package can repair this connection."
                                : "Checking the signed release feed for the latest Rasta package."
                              : stage === 0
                                ? "Downloading the Rasta package. You can keep using your app."
                                : stage === 1
                                  ? "Checking the package files and signature."
                                  : stage === 2
                                    ? preparation?.[1] || "Checking compatibility and setting up the installer."
                                    : stage === 3
                                      ? `Installing Rasta. Wait for ${app.name} to reopen.`
                                      : app.recovery
                                        ? `${app.name} updated. Prepare Rasta to restore reading support with your saved settings.`
                                        : `Prepare Rasta for ${app.name}${app.hostVersion ? ` ${app.hostVersion}` : ""}. The app stays open until you choose Launch.`}
            </p>
          </MotionEntry>
          <div role="status" className="sr-only">
            {isWorking && !ready && !failed && !complete ? activityLabel : ready ? "Ready to install. Choose Launch." : ""}
          </div>
          <div className="mt-5 grid min-w-0 grid-rows-[auto_1fr] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:grid-rows-1 sm:items-center sm:gap-3">
            <div className="min-h-4">{hostVersion}</div>
            <div className="grid min-h-14 min-w-0 content-center min-[480px]:min-h-9">
              {isWorking && !ready && !failed && !complete ? (
                <div className="flex justify-end">
                  <Button disabled aria-busy={!queued} className="h-auto min-h-9 max-w-full whitespace-normal">
                    <ActivityIcon icon={queued ? Hourglass : undefined} spinning={!queued} className="size-4" />
                    {activityLabel}
                  </Button>
                </div>
              ) : (
                <MotionEntry
                  key={
                    ready
                      ? "ready"
                      : failed
                        ? "failed"
                        : app.installed
                          ? "connected"
                          : "idle"
                  }
                  className="flex min-w-0 items-center justify-end gap-2 sm:gap-3"
                >
                  {ready ? (
                    <>
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        className="h-auto min-h-9 min-w-0 shrink whitespace-normal max-[479px]:px-2"
                        onClick={() => void perform(app, "cancel")}
                      >
                        Cancel installation
                      </Button>
                      <Button
                        disabled={Boolean(busy)}
                        className="h-auto min-h-9 min-w-0 shrink whitespace-normal max-[479px]:px-2"
                        onClick={() => void perform(app, "launch")}
                      >
                        {simulated ? "Simulate Launch" : `Launch ${app.name}`}
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : issue ? (
                    <Button
                      disabled={checking}
                      className="h-auto min-h-9 whitespace-normal text-left"
                      onClick={() => {
                        const action = offered ? "connect" : issue.action;
                        if (action === "check") void check(app.id);
                        else if (action === "refresh") void refresh();
                        else if (action === "settings") openSettings();
                        else void perform(app, action);
                      }}
                    >
                      {issue.action === "check" ? (
                        <Refresh className="size-4" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      {offered
                        ? "Download Rasta update"
                        : checking
                          ? "Checking…"
                          : issue.label}
                    </Button>
                  ) : !app.app ? (
                    <Button variant="outline" onClick={() => void refresh()}>
                      <Refresh className="size-4" />
                      Refresh app list
                    </Button>
                  ) : app.recovery ? (
                    <Button onClick={() => void perform(app, "repair")}>
                      <Undo className="size-4" />
                      Prepare recovery
                    </Button>
                  ) : app.installed && app.localTestBuildAvailable !== undefined ? (
                    app.localTestBuildAvailable && (
                      <Button onClick={() => void perform(app, "repair")}>
                        <Download className="size-4" />
                        Prepare test build
                      </Button>
                    )
                  ) : !app.installed || newer(update, app.version) ? (
                    <Button
                      disabled={!app.app}
                      onClick={() => void perform(app, "connect")}
                    >
                      <Download className="size-4" />
                      {app.installed
                        ? `Update Rasta for ${app.name}`
                        : `Install Rasta for ${app.name}`}
                    </Button>
                  ) : app.bundledVersion ? (
                    <Button variant="outline" onClick={() => void perform(app, "bundled")}>
                      Install bundled Rasta {app.bundledVersion}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={checking}
                      onClick={() => void check(app.id)}
                    >
                      <ActivityIcon
                        icon={Refresh}
                        spinning={checking}
                        className="size-4"
                      />
                      Check for Rasta update
                    </Button>
                  )}
                </MotionEntry>
              )}
            </div>
          </div>
        </section>
      </div>
      {current?.notice && !failed && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Using a previously verified Rasta package</AlertTitle>
          <AlertDescription>{current.notice}</AlertDescription>
        </Alert>
      )}
      {app.compatibility?.compatible === false && !failed && !isWorking && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>
            {app.compatibility.code === "app-verification-failed"
              ? `${app.name} could not be verified`
              : `This Rasta version cannot support ${app.name} ${app.hostVersion || ""}`}
          </AlertTitle>
          <AlertDescription>
            {app.compatibility.code === "app-verification-failed"
              ? `Reinstall ${app.name} from its official source, then refresh the app list.`
              : "Check for a newer Rasta package. Its support will be checked before installation."}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
