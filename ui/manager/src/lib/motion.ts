import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const contentMotion =
  "animate-in fade-in-0 slide-in-from-bottom-1 duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:animate-none!";
export const popMotion =
  "animate-in fade-in-0 zoom-in-90 duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:animate-none!";
export const overlayMotion =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--motion-ui) data-[state=closed]:duration-(--motion-exit) ease-(--motion-ease-out) motion-reduce:animate-none!";
export const dialogMotion =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 duration-(--motion-popup) data-[state=closed]:duration-(--motion-exit) ease-(--motion-ease-out) motion-reduce:animate-none!";
// Select releases its modal focus and screen-reader isolation on unmount.
export const menuMotion =
  "transition-none data-[state=open]:animate-in data-[state=closed]:animate-none! fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 duration-(--motion-ui) ease-(--motion-ease-out) motion-reduce:animate-none!";
export const trackIndicator = [
  "pointer-events-none absolute top-0 left-0 -z-10 origin-top-left rounded-[inherit] opacity-0",
  "bg-(--segment-selection) bg-(image:--segment-sheen) shadow-(--segment-shadow) backdrop-blur-xs",
  "before:absolute before:inset-0 before:rounded-[inherit] before:bg-(image:--segment-edge) before:p-px",
  // Intersect the horizontal fade with the outer-minus-inner rim.
  "before:[mask-image:var(--segment-edge-fade),linear-gradient(#fff_0_0),linear-gradient(#fff_0_0)]",
  "before:[mask-clip:border-box,border-box,content-box] before:[mask-composite:intersect,exclude]",
].join(" ");

export function canAnimate() {
  return (
    !document.hidden &&
    document.documentElement.dataset.keyboard !== "true" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Production CSS may minify 220ms to .22s; Web Animations always expects ms.
export function durationMilliseconds(value: string) {
  const time = value.trim();
  return Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
}

// Geometry is runtime content. FLIP animates only transform; measurements happen
// on selection/resize, never in a frame loop. The resting hit regions do not move.
export function useSlidingIndicator(selector: string) {
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const marker = indicator.current;
    const track = marker?.parentElement;
    if (!track || !marker) return;

    let animation: Animation | undefined;
    let previous:
      { left: number; top: number; width: number; height: number } | undefined;
    const measure = () => {
      const selected = track.querySelector<HTMLElement>(selector);
      if (!selected) {
        animation?.cancel();
        previous = undefined;
        marker.style.opacity = "0";
        return;
      }
      const next = {
        left: selected.offsetLeft,
        top: selected.offsetTop,
        width: selected.offsetWidth,
        height: selected.offsetHeight,
      };
      if (!next.width || !next.height) return;
      if (
        previous &&
        next.left === previous.left &&
        next.top === previous.top &&
        next.width === previous.width &&
        next.height === previous.height
      )
        return;

      // Reversals start at the current visual position, not the previous target.
      const currentTransform = getComputedStyle(marker).transform;
      const transform = new DOMMatrix(
        currentTransform === "none" ? undefined : currentTransform,
      );
      animation?.cancel();
      marker.style.width = `${next.width}px`;
      marker.style.height = `${next.height}px`;
      marker.style.left = `${next.left}px`;
      marker.style.top = `${next.top}px`;
      marker.style.opacity = "1";
      if (previous && canAnimate()) {
        const timing = getComputedStyle(track);
        animation = marker.animate(
          [
            {
              transform: `translate(${previous.left + transform.e - next.left}px, ${previous.top + transform.f - next.top}px) scale(${(previous.width * transform.a) / next.width}, ${(previous.height * transform.d) / next.height})`,
            },
            { transform: "none" },
          ],
          {
            duration: durationMilliseconds(timing.getPropertyValue("--motion-popup")),
            easing: timing.getPropertyValue("--motion-ease-out").trim(),
          },
        );
      }
      previous = next;
    };

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      if (!canAnimate()) animation?.cancel();
    };
    const observer = new MutationObserver(measure);
    observer.observe(track, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state", "aria-pressed"],
      childList: true,
    });
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    for (const control of track.querySelectorAll("button"))
      resize.observe(control);
    measure();
    document.addEventListener("keydown", cancel);
    document.addEventListener("visibilitychange", cancel);
    reduced.addEventListener("change", cancel);
    return () => {
      observer.disconnect();
      resize.disconnect();
      animation?.cancel();
      document.removeEventListener("keydown", cancel);
      document.removeEventListener("visibilitychange", cancel);
      reduced.removeEventListener("change", cancel);
    };
  }, [selector]);

  return indicator;
}

// Repeat only while visible, including inside a scrolled or portaled popup.
export function useActivity<T extends Element>(enabled = true) {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setActive(false);
      return;
    }
    let visible = false;
    const update = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled]);
  return { ref, active };
}
