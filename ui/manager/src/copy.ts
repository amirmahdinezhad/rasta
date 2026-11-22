import type { Connection, Phase } from "./model";

// Recovery actions come from service reason codes, never from matching error prose.
export function installationIssue(app: Connection, phase: Phase) {
  const name = app.name;
  const remove = phase.action === "restore" || phase.action === "remove";
  const fallback = {
    title: remove
      ? `Couldn’t remove Rasta from ${name}`
      : `Couldn’t install Rasta for ${name}`,
    description: remove
      ? `Retry removal from ${name}.`
      : "Choose Prepare Rasta to try again. Installation starts after you choose Launch.",
    label: remove ? "Retry removal" : "Prepare Rasta",
    action: remove ? "remove" : "connect",
  };
  if (phase.action === "launch" && phase.id && app.operation?.id === phase.id && app.operation.phase === "ready-to-install")
    return {
      title: `Couldn’t launch ${name}`,
      description: "The installation is still prepared. Choose Retry Launch to continue.",
      label: "Retry Launch",
      action: "launch",
    };
  const issues: Record<string, typeof fallback> = {
    "insufficient-disk-space": {
      ...fallback,
      title: "Not enough free disk space",
      description: remove
        ? `Free up space on your Mac, then retry removing Rasta from ${name}.`
        : "Free up space on your Mac, then choose Prepare Rasta again.",
    },
    "installer-not-started": {
      ...fallback,
      title: remove ? "Rasta removal didn’t start" : "Rasta preparation didn’t start",
    },
    "installer-stopped": {
      ...fallback,
      title: "The Rasta installer stopped",
    },
    "recovery-unavailable": {
      title: "Prepare recovery",
      description:
        phase.error ||
        `Prepare Rasta for the installed version of ${name}.`,
      label: "Prepare recovery",
      action: "repair",
    },
    "app-update-required": {
      title: `Update ${name} first`,
      description:
        phase.error ||
        `Update ${name} using its own updater, then return to Rasta and check again.`,
      label: "Check again",
      action: "connect",
    },
    "rasta-update-required": {
      title: `Rasta isn’t available for this ${name} version yet`,
      description: `The available Rasta package cannot support ${name}${app.hostVersion ? ` ${app.hostVersion}` : ""}. The Rasta developer needs to release a compatible package. Check for a Rasta update later.`,
      label: "Check for Rasta update",
      action: "check",
    },
    "release-check-failed": {
      title: `Couldn’t check for a Rasta update for ${name}`,
      description:
        "The update check did not finish. Check your internet connection and try again. Compatibility with the latest Rasta package has not been checked.",
      label: "Check for Rasta update",
      action: "check",
    },
    "download-failed": {
      title: `Couldn’t download Rasta for ${name}`,
      description:
        "The download did not finish. Check your internet connection, then retry the download.",
      label: "Retry download",
      action: "connect",
    },
    "verification-failed": {
      title: "The Rasta download could not be verified",
      description: `Download a verified Rasta package for ${name} to continue.`,
      label: "Download Rasta",
      action: "redownload",
    },
    "release-verification-failed": {
      title: "Rasta update information could not be verified",
      description:
        "Rasta could not confirm that the update information is authentic. No package will be downloaded. Check for a Rasta update again.",
      label: "Check for Rasta update",
      action: "check",
    },
    "app-verification-failed": {
      title: `${name} could not be verified`,
      description: `Rasta cannot confirm that the app files are intact. Reinstall ${name} from its official source, then return here and check again.`,
      label: "Check again",
      action: "connect",
    },
    "manager-update-required": {
      title: "Update the Rasta app first",
      description:
        phase.error ||
        `Open Rasta settings and update the Rasta app. Then return here to install Rasta for ${name}.`,
      label: "Open Rasta settings",
      action: "settings",
    },
    "app-not-found": {
      title: `${name} could not be found`,
      description: `Install ${name} on this Mac, then refresh the app list.`,
      label: "Refresh app list",
      action: "refresh",
    },
    "app-quit-failed": {
      title: `Finish closing ${name}`,
      description: `Resolve any quit prompt in ${name}, then prepare Rasta. After choosing Launch, use Command-Q if the app stays open.`,
      label: "Prepare Rasta",
      action: "connect",
    },
    "keychain-authorization-failed": {
      title: "Keychain access could not be authorized",
      description: `Prepare Rasta again, choose Launch and approve the macOS Keychain request for ${name} if prompted.`,
      label: "Prepare Rasta",
      action: "connect",
    },
    "startup-unconfirmed": {
      title: "Rasta was installed; startup needs checking",
      description: `Close and reopen ${name}, then check whether Rasta reading support works. If it does not, use Repair Rasta below.`,
      label: "Refresh status",
      action: "refresh",
    },
    "runtime-unavailable": {
      title: `Download Rasta for ${name}`,
      description:
        "The local Rasta package is missing. Download a verified package to prepare the installation.",
      label: "Download Rasta",
      action: "connect",
    },
    "compatibility-check-failed": {
      title: `Couldn’t check Rasta support for ${name}`,
      description:
        "The compatibility check did not finish. Prepare Rasta, or use Download Rasta in the details below to get a fresh package.",
      label: "Prepare Rasta",
      action: "connect",
    },
  };
  return issues[phase.code || ""] || (!remove && phase.installed ? issues["startup-unconfirmed"] : fallback);
}
