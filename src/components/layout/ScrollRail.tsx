"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A left / right scroll bar that stays at the bottom of the window for whichever wide table is on screen.
 * The tables scroll sideways inside their cards, but a tall table's own scroll bar sits far below the
 * screen – so this rail follows the table in view, moves it with the thumb or the arrows, and goes away
 * when the table's own bar is visible or nothing is wider than the screen.
 */
interface Rail {
  el: HTMLElement;
  left: number;
  width: number;
  scrollWidth: number;
  clientWidth: number;
}

const SELECTOR = ".overflow-x-auto, .overflow-auto";

export function ScrollRail() {
  const [rail, setRail] = useState<Rail | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const onElScroll = () => {
      const el = activeRef.current;
      if (el && barRef.current && Math.abs(barRef.current.scrollLeft - el.scrollLeft) > 1) barRef.current.scrollLeft = el.scrollLeft;
    };
    const pick = () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      let best: HTMLElement | null = null;
      let bestVisible = 0;
      for (const e of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
        if (e.scrollWidth <= e.clientWidth + 4 || !e.querySelector("table")) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 200 || r.bottom <= vh - 20 || r.top >= vh - 60 || r.bottom <= 0) continue; // its own bar is on screen, or it is off screen
        const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        if (visible > bestVisible) {
          bestVisible = visible;
          best = e;
        }
      }
      if (best !== activeRef.current) {
        activeRef.current?.removeEventListener("scroll", onElScroll);
        activeRef.current = best;
        best?.addEventListener("scroll", onElScroll, { passive: true });
      }
      if (!best) {
        setRail((r) => (r ? null : r));
        return;
      }
      const r = best.getBoundingClientRect();
      const next: Rail = { el: best, left: Math.max(8, r.left), width: Math.min(r.width, vw - Math.max(8, r.left) - 8), scrollWidth: best.scrollWidth, clientWidth: best.clientWidth };
      setRail((cur) => (cur && cur.el === next.el && cur.left === next.left && cur.width === next.width && cur.scrollWidth === next.scrollWidth && cur.clientWidth === next.clientWidth ? cur : next));
      onElScroll();
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(pick);
    };
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open"] });
    schedule();
    const tick = window.setInterval(schedule, 1500); // widths that change without a DOM event (fonts, images)
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tick);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      activeRef.current?.removeEventListener("scroll", onElScroll);
    };
  }, []);

  if (!rail) return null;
  const step = Math.max(240, Math.round(rail.clientWidth * 0.6));
  const nudge = (dir: -1 | 1) => rail.el.scrollBy({ left: dir * step, behavior: "smooth" });
  return (
    <div className="scroll-rail-box fixed bottom-2 z-40 flex items-center gap-1 rounded-xl border border-line bg-white/95 px-1 py-1 shadow-lg backdrop-blur" style={{ left: rail.left, width: rail.width }} data-nocopy>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudge(-1)} title="Scroll the table left" aria-label="Scroll left">
        <ChevronLeft size={16} />
      </button>
      <div
        ref={barRef}
        className="scroll-rail h-4 min-w-0 flex-1 overflow-x-scroll overflow-y-hidden"
        onScroll={(e) => {
          const el = activeRef.current;
          if (el && Math.abs(el.scrollLeft - e.currentTarget.scrollLeft) > 1) el.scrollLeft = e.currentTarget.scrollLeft;
        }}
        title="Drag to scroll the table sideways"
      >
        <div style={{ width: rail.scrollWidth, height: 1 }} />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudge(1)} title="Scroll the table right" aria-label="Scroll right">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
