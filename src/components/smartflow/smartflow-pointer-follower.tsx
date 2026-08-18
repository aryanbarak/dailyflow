import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ORB_COLOR_VAR, ORB_SIZE_PX, useAppearance } from "@/features/settings/appearanceStore";
import { useMicroBreaksStore } from "@/features/micro-breaks/store/microBreaksStore";
import { setLastPointerPosition } from "@/features/micro-breaks/pointerPositionRef";

type Point = {
  x: number;
  y: number;
};

export function SmartflowPointerFollower() {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef<Point>({ x: 0, y: 0 });
  const currentRef = useRef<Point>({ x: 0, y: 0 });
  const [hasPointer, setHasPointer] = useState(false);

  // Task 17h: user-configurable from Settings -> Appearance -- see
  // appearanceStore.ts's own comment for why the orb* fields live there
  // rather than a dedicated store. Defaults reproduce this component's
  // ORIGINAL hardcoded look exactly (primary/144px/0.72).
  const orbEnabled = useAppearance(s => s.orbEnabled);
  const orbColor = useAppearance(s => s.orbColor);
  const orbSize = useAppearance(s => s.orbSize);
  const orbOpacity = useAppearance(s => s.orbOpacity);
  const sizePx = ORB_SIZE_PX[orbSize];

  // ADR-0014 §5: while a Micro Break is active, this component is fully
  // suspended (no rAF loop, no window listeners) via the micro-breaks
  // store's own `gameActive` flag -- MicroBreakOverlay renders its own
  // handoff clone at this component's last known position (see
  // pointerPositionRef.ts), built from the SAME shared orb tokens
  // (orbTokens.ts), so hiding this component outright here is pop-free.
  const gameActive = useMicroBreaksStore(s => s.gameActive);

  useEffect(() => {
    if (!orbEnabled || gameActive) return; // Task 17h / ADR-0014 §5: off switch or an active break -- no listeners, no animation loop at all.

    const supportsFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!supportsFinePointer || reduceMotion) return;

    const root = rootRef.current;
    if (!root) return;

    const halfSizePx = sizePx / 2;

    const handlePointerMove = (event: PointerEvent) => {
      targetRef.current = { x: event.clientX, y: event.clientY };
      setLastPointerPosition(event.clientX, event.clientY); // ADR-0014 §5: feeds the orb handoff transition on Micro Break entry
      setHasPointer(true);
    };

    const animate = () => {
      const current = currentRef.current;
      const target = targetRef.current;

      current.x += (target.x - current.x) * 0.085;
      current.y += (target.y - current.y) * 0.085;

      // Task 17h performance guard: this is the ONLY per-frame style
      // write, exactly as before this task -- colour/size/opacity are
      // applied as CSS custom properties on the element below, set once
      // per React render (i.e. once per preference change), never here.
      root.style.transform = `translate3d(${current.x - halfSizePx}px, ${current.y - halfSizePx}px, 0)`;
      frameRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [orbEnabled, gameActive, sizePx]);

  if (!orbEnabled || gameActive) return null;

  const colorVar = `var(${ORB_COLOR_VAR[orbColor]})`;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-20 rounded-full mix-blend-screen transition-opacity duration-500"
      style={
        {
          width: "var(--orb-size)",
          height: "var(--orb-size)",
          opacity: hasPointer ? "var(--orb-opacity)" : 0,
          willChange: "transform, opacity",
          "--orb-size": `${sizePx}px`,
          "--orb-opacity": orbOpacity,
          "--orb-color": colorVar,
        } as CSSProperties
      }
    >
      <div
        className="absolute inset-0 rounded-full blur-xl"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, hsl(0 0% 100% / 0.5), color-mix(in srgb, var(--orb-color) 34%, transparent) 18%, color-mix(in srgb, var(--orb-color) 12%, transparent) 42%, transparent 70%)",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
        style={{ boxShadow: "0 0 28px color-mix(in srgb, var(--orb-color) 78%, transparent)" }}
      />
      <div
        className="absolute inset-[22%] rounded-full border"
        style={{ borderColor: "color-mix(in srgb, var(--orb-color) 25%, transparent)" }}
      />
    </div>
  );
}
