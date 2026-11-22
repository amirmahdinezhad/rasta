import { toast } from "sonner";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Download } from "@neaticons/react";
import { installationIssue } from "./copy";
export type Phase = {
  startedAt?: number;
  id?: string;
  phase: string;
  action?: string;
  progress?: number;
  downloaded?: number;
  total?: number;
  preparationStep?: "verifying-app" | "preparing-files" | "signing-app" | "verifying-copy";
  error?: string;
  restored?: boolean;
  installed?: boolean;
  code?: string;
  notice?: string;
  checkedVersion?: string;
};
export type Connection = {
  requestStartedAt?: number;
  id: string;
  name: string;
  description: string;
  app?: string;
  installed?: boolean;
  available?: boolean;
  hostVersion?: string;
  version?: string;
  cachedVersion?: string;
  localTestBuildAvailable?: boolean;
  bundledVersion?: string;
  stalePreparation?: boolean;
  recovery?: { fingerprint: string; version: string | null };
  autoRecovery?: boolean;
  removalPhase?: "queued" | "removing";
  operation?: Phase;
  download?: Phase;
  reason?: string;
  error?: string;
  requestFailure?: Phase;
  compatibility?: {
    compatible: boolean;
    tested?: boolean;
    status: string;
    message?: string;
    code?: string;
  };
};
export type Preferences = {
  selected: string;
  vazirRemoved?: boolean;
  fonts: { id: string; label: string; data?: string }[];
  active: { id: string; data: string } | null;
  reading: {
    fs: string;
    lh: string;
    isRTL: boolean;
    forceRTL: boolean;
    fixAtSign: boolean;
  };
};
export type ManagerState = {
  version?: string;
  localTest?: boolean;
  apps: Connection[];
  coreUpdate?: Omit<Phase, "progress"> & { progress?: number | null; version?: string };
  removal?: {
    phase: "removing" | "complete" | "failed";
    startedAt: number;
    apps: Array<{
      id: string;
      name: string;
      phase: "queued" | "removing" | "complete" | "failed";
      operation?: string;
      error?: string;
    }>;
  };
};
type Request = {
  action: string;
  target?: string;
  input?: unknown;
  bundled?: boolean;
  job?: string;
  fingerprint?: string;
};
declare global {
  interface Window {
    rastaPreview?: (request: Request) => Promise<any>;
    rastaPreviewControl?: {
      reset: () => void;
      setFailure: (value: boolean) => void;
      setCoreOffer: (value: boolean) => void;
      coreOffer: () => boolean;
      failure: () => boolean;
      setScenario?: (scenario: string) => void;
      scenario?: () => string;
    };
    rastaModernUI?: boolean;
    rastaReply?: (reply: {
      id: number;
      response: {
        ok: boolean;
        value: any;
        error?: string;
        code?: string;
        checkedVersion?: string;
      };
    }) => void;
    rastaOpenConnection?: (id: string, view?: "reading" | "connection") => void;
    webkit?: {
      messageHandlers: {
        rasta: { postMessage: (request: Request & { id: number }) => void };
      };
    };
  }
}
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let sequence = 0;
window.rastaReply = ({ id, response }) => {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  response.ok
    ? entry.resolve(response.value)
    : entry.reject(
        Object.assign(Error(response.error), {
          code: response.code,
          checkedVersion: response.checkedVersion,
        }),
      );
};
export async function rpc(request: Request): Promise<any> {
  if (window.rastaPreview) return window.rastaPreview(request);
  if (!window.webkit?.messageHandlers.rasta)
    throw Error(
      "Rasta could not reach its installation service. Close and reopen the Rasta app, then try again.",
    );
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    window.webkit!.messageHandlers.rasta.postMessage({ ...request, id });
  });
}
export const catalog: Connection[] = [
  {
    id: "codex",
    name: "Codex",
    description: "Reading direction and fonts for Codex conversations.",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Reading direction and fonts for Claude conversations.",
  },
  {
    id: "t3",
    name: "T3 Code",
    description: "Reading direction and fonts for T3 Code conversations.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    description: "Reading direction and fonts for Antigravity conversations.",
  },
  {
    id: "grokbot",
    name: "Grok Bot",
    description: "Reading direction and fonts for Grok Bot conversations.",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Reading direction and fonts for Gemini conversations.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Reading direction and fonts for OpenCode conversations.",
  },
  {
    id: "zcode",
    name: "ZCode",
    description: "Reading direction and fonts for ZCode conversations.",
  },
];
const active = new Set([
  "starting",
  "checking",
  "downloading-agent",
  "downloading-app",
  "verifying",
  "preparing",
  "ready-to-install",
  "authorizing-keychain",
  "quitting",
  "waiting-for-quit",
  "installing",
  "reopening",
]);
export const running = (app: Connection) =>
  active.has(app.operation?.phase || "");
export const isRemoval = (phase?: Phase) =>
  phase?.action === "remove" || phase?.action === "restore" || phase?.restored === true;
export const preparedForFirstInstall = (app: Connection) =>
  !app.installed && !app.recovery && app.operation?.phase === "ready-to-install";

function supersededLaunchFailure(failure: Phase, operation?: Phase) {
  return failure.action === "launch" && Boolean(failure.id) &&
    operation?.id === failure.id && operation?.phase !== "ready-to-install";
}

export function connectionPhase(
  app: Connection,
  busy?: string,
): Phase | undefined {
  if (app.removalPhase === "queued") return { phase: "queued", action: "restore" };
  if (app.removalPhase === "removing") {
    if (running(app) && isRemoval(app.operation)) return app.operation;
    return { phase: "starting", action: "restore" };
  }
  if (app.requestFailure && !supersededLaunchFailure(app.requestFailure, app.operation)) return app.requestFailure;
  if (busy === "launch" && app.operation?.phase === "ready-to-install")
    return { ...app.operation, phase: "checking", progress: 1 };
  if (["connect", "bundled", "download", "redownload", "repair", "recover", "remove"].includes(busy || "")) {
    const since = app.requestStartedAt || 0;
    if (app.operation && (app.operation.startedAt ?? 0) >= since) return app.operation;
    if (busy === "remove") return { phase: "starting", action: "restore" };
    const download = app.download;
    if (download && (download.startedAt ?? 0) >= since && download.phase !== "idle")
      return download.phase === "downloaded" ? { phase: "preparing" } : download;
    return { phase: "checking" };
  }
  if (running(app)) return app.operation;
  if (app.download?.phase === "failed" && (app.download.startedAt ?? 0) >= (app.operation?.startedAt ?? 0)) return app.download;
  if (
    app.operation?.phase === "complete" &&
    (app.recovery || app.operation.restored || app.operation.action === "restore")
  )
    return undefined;
  return app.operation;
}
export const newer = (a?: string, b?: string) =>
  (a || "")
    .split(".")
    .map(Number)
    .reduce(
      (result, value, index) =>
        result || Math.sign(value - (Number(b?.split(".")[index]) || 0)),
      0,
    ) > 0;
export const STATUS_POLL_MS = 500;

export function useManager() {
  const [state, setState] = useState<ManagerState>({ apps: [] });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [requestStarted, setRequestStarted] = useState<Record<string, number>>({});
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [failures, setFailures] = useState<Record<string, Phase>>({});
  const checkingRef = useRef(false),
    polling = useRef<Promise<ManagerState | undefined> | null>(null),
    statusError = useRef(""),
    tasks = useRef(new Set<string>());
  const attemptedRecoveries = useRef(new Map<string, string>());
  const removalJobs = useRef(new Map<string, string>());
  const refresh = useCallback(() => {
    if (polling.current) return polling.current;
    const request = async () => { try {
      const result = (await rpc({ action: "status" })) as ManagerState;
      setState(result);
      if (statusError.current) {
        statusError.current = "";
        toast.dismiss("connection-status-error");
      }
      return result;
    } catch (e) {
      const message = (e as Error).message;
      if (message !== statusError.current) {
        statusError.current = message;
        toast.error(message, { id: "connection-status-error" });
      }
    } finally {
      setLoadingStatus(false);
      polling.current = null;
    } };
    return (polling.current = request());
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, STATUS_POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  const batchRemoval = state.removal?.phase === "removing" ? state.removal.apps : [];
  const apps = catalog.map((entry): Connection => {
    const app = { ...entry, ...state.apps.find((value) => value.id === entry.id) };
    const batchPhase = batchRemoval.find((value) => value.id === app.id)?.phase;
    const removing = busy[app.id] === "remove" || (running(app) && isRemoval(app.operation)) || batchPhase === "removing";
    return {
      ...app,
      removalPhase: removing ? "removing" : batchPhase === "queued" ? "queued" : undefined,
      requestFailure: failures[app.id],
      requestStartedAt: requestStarted[app.id],
    };
  });
  const perform = async (app: Connection, action: string) => {
    if (tasks.current.has(app.id) || app.available === false) return;
    tasks.current.add(app.id);
    setRequestStarted((value) => ({ ...value, [app.id]: Date.now() }));
    setFailures((value) => {
      const next = { ...value };
      delete next[app.id];
      return next;
    });
    setBusy((value) => ({ ...value, [app.id]: action }));
    if (
      ["connect", "bundled", "repair", "recover", "download", "redownload"].includes(
        action,
      )
    )
      setUpdates((value) => {
        const next = { ...value };
        delete next[app.id];
        return next;
      });
    let launchFailure: Phase | undefined;
    try {
      if (
        action === "connect" ||
        action === "download" ||
        action === "redownload"
      ) {
        if (action !== "connect")
          await rpc({ action: "download", target: app.id });
        if (action !== "download") {
          const result = await rpc({ action: "install", target: app.id });
          if (result.notice) toast.info(result.notice);
        }
      } else if (action === "bundled")
        await rpc({ action: "install", target: app.id, bundled: true });
      else if (action === "launch" || action === "cancel")
        await rpc({ action, target: app.id, job: app.operation?.id });
      else if (action === "recover")
        await rpc({
          action,
          target: app.id,
          fingerprint: app.recovery?.fingerprint,
        });
      else {
        const result = await rpc({ action, target: app.id });
        if (action === "remove" && result.id) removalJobs.current.set(app.id, result.id);
      }
    } catch (e) {
      const error = e as Error & { code?: string; checkedVersion?: string };
      const phase = {
        id: action === "launch" ? app.operation?.id : undefined,
        phase: "failed",
        action,
        error: error.message,
        code: error.code,
        checkedVersion: error.checkedVersion,
      };
      if (action === "launch") launchFailure = phase;
      else {
        setFailures((value) => ({ ...value, [app.id]: phase }));
        toast.error(installationIssue(app, phase).title);
      }
    } finally {
      await polling.current;
      const status = await refresh();
      const operation = status?.apps.find((item) => item.id === app.id)?.operation;
      if (launchFailure && !supersededLaunchFailure(launchFailure, operation)) {
        const failure = launchFailure;
        setFailures((value) => ({ ...value, [app.id]: failure }));
      }
      tasks.current.delete(app.id);
      setBusy((value) => {
        const next = { ...value };
        delete next[app.id];
        return next;
      });
    }
  };
  useEffect(() => {
    for (const app of state.apps) {
      const job = removalJobs.current.get(app.id);
      const status = app.operation;
      if (!job || status?.id !== job || !["complete", "failed", "cancelled"].includes(status.phase)) continue;
      removalJobs.current.delete(app.id);
      if (status.phase === "complete" && status.restored) toast.success(`Rasta removed from ${app.name}.`);
    }
  }, [state.apps]);
  useEffect(() => {
    if (tasks.current.size || document.hidden || state.removal?.phase === "removing") return;
    const app = apps.find(
      (item) =>
        item.autoRecovery &&
        item.recovery &&
        !running(item) &&
        attemptedRecoveries.current.get(item.id) !== item.recovery.fingerprint,
    );
    if (!app?.recovery) return;
    attemptedRecoveries.current.set(app.id, app.recovery.fingerprint);
    void perform(app, "recover");
  });
  const check = async (target?: string) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const targets = target
        ? apps.filter((a) => a.id === target)
        : apps.filter((a) => a.app && a.available !== false);
      if (!targets.length) {
        toast.info(
          "No installed apps are available to check. Install an app, then refresh the app list.",
        );
        return;
      }
      const results = await Promise.allSettled(
        targets.map(async (a) => {
          const result = await rpc({ action: "check", target: a.id });
          setUpdates((previous) => ({ ...previous, [a.id]: result.version }));
          setFailures((value) => {
            const next = { ...value };
            delete next[a.id];
            return next;
          });
          return newer(
            result.version,
            connectionPhase(a)?.checkedVersion ||
              (a.installed ? a.version : a.cachedVersion),
          );
        }),
      );
      const failed = results.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (results.some((r) => r.status === "fulfilled" && r.value)) {
        toast.info(
          target
            ? `A Rasta package is available for ${targets[0].name}. Open Installation to download it and check compatibility.`
            : "Rasta updates are available. Open an app’s Installation tab to review its update.",
          {
            icon: createElement(Download),
          },
        );
      } else {
        toast.success(
          target
            ? `No Rasta update available for ${targets[0].name}.`
            : "No Rasta updates available.",
        );
      }
    } catch (e) {
      const error = e as Error & { code?: string };
      setUpdates((value) => {
        if (!target) return {};
        const next = { ...value };
        delete next[target];
        return next;
      });
      if (target)
        setFailures((value) => ({
          ...value,
          [target]: {
            phase: "failed",
            action: "check",
            code: error.code || "release-check-failed",
            error: error.message,
          },
        }));
      toast.error(
        [
          "manager-update-required",
        ].includes(error.code || "")
          ? error.message
          : "Couldn’t check for Rasta updates. Check your internet connection, then try again.",
      );
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };
  return {
    state,
    loadingStatus,
    apps,
    busy,
    updates,
    checking,
    refresh,
    perform,
    check,
    clearFailure: (id: string) =>
      setFailures((value) => {
        const next = { ...value };
        delete next[id];
        return next;
      }),
  };
}
