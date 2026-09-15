/**
 * How the dashboard looks: the theme, the colour, whether the buttons are raised or flat, and the
 * text size. Kept on the machine it is set on (browsers call this local storage), because a choice
 * like text size belongs to the screen in front of you rather than to the login – a big monitor in
 * the office and a laptop on site want different answers.
 *
 * Everything is driven by data attributes on <html>, which the stylesheet reads, so nothing on any
 * page has to know about it.
 */

export type ThemeName = "light" | "dark";
export type ColourName = "navy" | "teal" | "forest" | "plum" | "slate" | "burgundy";
export type ButtonStyle = "raised" | "flat";
export type TextSize = "normal" | "large";

export interface Appearance {
  theme: ThemeName;
  colour: ColourName;
  buttons: ButtonStyle;
  text: TextSize;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "light", colour: "navy", buttons: "raised", text: "normal" };

export const THEMES: { value: ThemeName; label: string; help: string }[] = [
  { value: "light", label: "Light", help: "Dark text on a pale background – the usual office setting, and what prints best." },
  { value: "dark", label: "Dark", help: "Pale text on a dark background; easier on the eyes in a dim room or late in the day." },
];

/** Each colour is a whole set: the menu, the headings, the buttons and the highlights move together. */
export const COLOURS: { value: ColourName; label: string; swatch: string; help: string }[] = [
  { value: "navy", label: "Navy", swatch: "#0f2b4c", help: "The dashboard's own colour." },
  { value: "teal", label: "Teal", swatch: "#0f4c4c", help: "Cooler and greener than the navy." },
  { value: "forest", label: "Forest", swatch: "#14452a", help: "A deep green." },
  { value: "plum", label: "Plum", swatch: "#3b1f4d", help: "A deep purple." },
  { value: "slate", label: "Slate", swatch: "#2b3440", help: "Grey, for the least colour of all." },
  { value: "burgundy", label: "Burgundy", swatch: "#4a1d24", help: "A deep red." },
];

export const BUTTON_STYLES: { value: ButtonStyle; label: string; help: string }[] = [
  { value: "raised", label: "Raised (3D)", help: "Buttons and cards are shaded so they stand off the page and press down when clicked." },
  { value: "flat", label: "Flat", help: "No gradients or shadows – plainer, and quicker to read on a small or low-contrast screen." },
];

export const TEXT_SIZES: { value: TextSize; label: string; help: string }[] = [
  { value: "normal", label: "Normal", help: "The standard size." },
  { value: "large", label: "Large", help: "About a tenth bigger throughout, for a large monitor or tired eyes." },
];

export const APPEARANCE_KEY = "cd_appearance";

const THEME_VALUES = new Set(THEMES.map((t) => t.value as string));
const COLOUR_VALUES = new Set(COLOURS.map((c) => c.value as string));
const BUTTON_VALUES = new Set(BUTTON_STYLES.map((b) => b.value as string));
const TEXT_VALUES = new Set(TEXT_SIZES.map((t) => t.value as string));

/** Anything unrecognised falls back to the default, so a half-written setting can never break the page. */
export function readAppearance(raw: string | null): Appearance {
  if (!raw) return { ...DEFAULT_APPEARANCE };
  try {
    const o = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: THEME_VALUES.has(String(o.theme)) ? (o.theme as ThemeName) : DEFAULT_APPEARANCE.theme,
      colour: COLOUR_VALUES.has(String(o.colour)) ? (o.colour as ColourName) : DEFAULT_APPEARANCE.colour,
      buttons: BUTTON_VALUES.has(String(o.buttons)) ? (o.buttons as ButtonStyle) : DEFAULT_APPEARANCE.buttons,
      text: TEXT_VALUES.has(String(o.text)) ? (o.text as TextSize) : DEFAULT_APPEARANCE.text,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Puts the choice on <html>; the stylesheet does the rest. */
export function applyAppearance(a: Appearance) {
  const el = document.documentElement;
  el.dataset.theme = a.theme;
  el.dataset.colour = a.colour;
  el.dataset.buttons = a.buttons;
  el.dataset.text = a.text;
}

export function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    // a browser with storage switched off still gets the change for this visit
  }
  applyAppearance(a);
}

export function loadAppearance(): Appearance {
  try {
    return readAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/**
 * Runs before the page is painted, so the chosen look is already on screen rather than flashing the
 * default first. Written as a string because it has to be inline in the document head.
 */
export const APPEARANCE_BOOT = `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"{}");var d=document.documentElement;d.dataset.theme=["light","dark"].indexOf(a.theme)>=0?a.theme:"light";d.dataset.colour=${JSON.stringify([...COLOUR_VALUES])}.indexOf(a.colour)>=0?a.colour:"navy";d.dataset.buttons=["raised","flat"].indexOf(a.buttons)>=0?a.buttons:"raised";d.dataset.text=["normal","large"].indexOf(a.text)>=0?a.text:"normal";}catch(e){}})();`;
