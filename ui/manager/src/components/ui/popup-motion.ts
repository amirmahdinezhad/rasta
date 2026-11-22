import { useState } from "react";

// Snapshot modality per opening; changing input while open must not replay entry motion.
const keyboardInput = (surface?: HTMLElement) =>
  typeof document !== "undefined" &&
  (surface ?? document.documentElement).dataset.keyboard === "true";

export function usePopupEntryMotion(open: boolean, surface?: HTMLElement) {
  const [entry, setEntry] = useState(() => ({ open, instant: keyboardInput(surface) }));
  if (entry.open !== open) {
    const next = {
      open,
      instant: keyboardInput(surface) || (!open && entry.instant),
    };
    setEntry(next);
    return next.instant;
  }
  return entry.instant;
}
