"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Check, RotateCcw } from "lucide-react";
import { APPEARANCE_KEY, BUTTON_STYLES, COLOURS, DEFAULT_APPEARANCE, TEXT_SIZES, THEMES, readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { Chip } from "@/components/ui/Chip";

/**
 * The look of the dashboard, changed as it is picked so the choice can be judged on the real page
 * rather than on a description of it.
 */
export function AppearanceSettings() {
  // local storage is an outside store, so it is read through the hook meant for one: the server and
  // the first paint both see the standard look, and the saved choice arrives without a second render
  // fighting the first. The page itself is already correct – the boot script set it before paint.
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const a = useMemo(() => readAppearance(raw), [raw]);

  const set = useCallback(
    (p: Partial<Appearance>) => {
      saveAppearance({ ...readAppearance(getSnapshot()), ...p });
      // saveAppearance writes the key; tell this tab, since "storage" only fires in the others
      window.dispatchEvent(new Event(APPEARANCE_EVENT));
    },
    [],
  );

  const isDefault = JSON.stringify(a) === JSON.stringify(DEFAULT_APPEARANCE);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Theme" hint="Light prints best and suits a bright office; dark is easier on the eyes in a dim room.">
          <div className="grid gap-2 sm:grid-cols-2">
            {THEMES.map((t) => (
              <Choice key={t.value} on={a.theme === t.value} label={t.label} help={t.help} onPick={() => set({ theme: t.value })} />
            ))}
          </div>
        </Panel>

        <Panel title="Colour" hint="Sets the menu, the headings, the buttons and the highlights in one go.">
          <div className="grid gap-2 sm:grid-cols-2">
            {COLOURS.map((c) => (
              <Choice
                key={c.value}
                on={a.colour === c.value}
                label={c.label}
                help={c.help}
                swatch={c.swatch}
                onPick={() => set({ colour: c.value })}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Buttons and cards" hint="Whether things stand off the page or sit flat on it.">
          <div className="grid gap-2 sm:grid-cols-2">
            {BUTTON_STYLES.map((b) => (
              <Choice key={b.value} on={a.buttons === b.value} label={b.label} help={b.help} onPick={() => set({ buttons: b.value })} />
            ))}
          </div>
        </Panel>

        <Panel title="Text size" hint="Applies to every page, not just this one.">
          <div className="grid gap-2 sm:grid-cols-2">
            {TEXT_SIZES.map((t) => (
              <Choice key={t.value} on={a.text === t.value} label={t.label} help={t.help} onPick={() => set({ text: t.value })} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">How it looks</h2>
        <p className="mb-3 text-xs text-muted">The page around you has already changed; this is a corner of it in one place.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary">Primary</button>
          <button className="btn btn-secondary">Secondary</button>
          <button className="btn btn-pdf">PDF</button>
          <button className="btn btn-excel">Excel</button>
          <Chip tone="red">Overdue</Chip>
          <Chip tone="amber">Watch</Chip>
          <Chip tone="green">On track</Chip>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-page p-3">
          <p className="text-sm text-ink">Ordinary text on a panel, with <a className="text-accent underline" href="#">a link</a> and <span className="tnum font-semibold">1,403,462,418</span> in figures.</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
          Kept on this computer, in this browser – a choice like text size belongs to the screen in front of you rather than to your login, so a laptop on site and the monitor in the office can each
          have their own. Nothing here changes the figures, the reports or anything anyone else sees.
        </p>
        <button className="btn btn-secondary btn-sm shrink-0" disabled={isDefault} onClick={() => set(DEFAULT_APPEARANCE)}>
          <RotateCcw size={14} /> Back to the standard look
        </button>
      </div>
    </div>
  );
}

/** local storage tells the other tabs; this tells our own. */
const APPEARANCE_EVENT = "cd-appearance-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(APPEARANCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(APPEARANCE_EVENT, onChange);
  };
}
function getSnapshot(): string | null {
  try {
    return localStorage.getItem(APPEARANCE_KEY);
  } catch {
    return null;
  }
}
function getServerSnapshot(): string | null {
  return null;
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>
      {children}
    </div>
  );
}

function Choice({ on, label, help, swatch, onPick }: { on: boolean; label: string; help: string; swatch?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={`rounded-lg border p-3 text-left transition ${on ? "border-navy bg-navy/5 ring-1 ring-navy" : "border-line bg-white hover:border-navy"}`}
    >
      <span className="flex items-center gap-2">
        {swatch && <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: swatch }} />}
        <span className={`text-sm font-semibold ${on ? "text-navy" : "text-ink"}`}>{label}</span>
        {on && <Check size={14} className="ml-auto shrink-0 text-navy" />}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-muted">{help}</span>
    </button>
  );
}
