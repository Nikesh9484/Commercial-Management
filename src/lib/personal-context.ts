import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * A private project / period choice for read-only accounts (Viewer and "Reports only").
 *
 * The project, sub-asset and reporting period in the top bar are one shared setting: when an
 * Editor moves to Report No 51, everybody's pages follow. That is right for the people who keep the
 * data, but it meant a read-only user could not look at VBH, or at last month, without moving the
 * Admin's screen with them – so their drop-downs were simply locked.
 *
 * Now a read-only user's choice is kept in their own browser (the `cd_view` cookie) and applies to
 * their requests only. It is read wherever the shared setting is read (getSetting in db.ts), so every
 * page, register, report and download they open follows it without each one having to know. Nothing
 * is written to the shared settings, and Admins / Editors / Data entry are unaffected.
 */

export const VIEW_COOKIE = "cd_view";
export const PERSONAL_ROLES = new Set(["viewer", "reporter"]);
/** The shared settings a personal choice stands in for. */
const KEYS = { current_programme_id: "p", current_asset_id: "a", current_period_id: "r" } as const;

export interface PersonalChoice {
  p?: number;
  a?: number;
  r?: number;
}

type CookieReader = { get(name: string): { value: string } | undefined };

/** The cookies of the request being served, or null outside a request (scripts, start-up). */
function requestCookies(): CookieReader | null {
  try {
    const store = workUnitAsyncStorage.getStore() as { type?: string; cookies?: CookieReader } | undefined;
    return store && store.type === "request" && store.cookies ? store.cookies : null;
  } catch {
    return null;
  }
}

/** The role in the login token. The proxy has already verified the token's signature on this request. */
function tokenRole(cookies: CookieReader): string | null {
  const token = cookies.get("cd_session")?.value;
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function parseChoice(raw: string | undefined | null): PersonalChoice | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);
    const c = { p: n(j.p), a: n(j.a), r: n(j.r) };
    return c.p || c.a || c.r ? c : null;
  } catch {
    return null;
  }
}

/** This request's personal choice, when it comes from a read-only account that has made one. */
export function personalChoice(): PersonalChoice | null {
  const cookies = requestCookies();
  if (!cookies) return null;
  const role = tokenRole(cookies);
  if (!role || !PERSONAL_ROLES.has(role)) return null;
  return parseChoice(cookies.get(VIEW_COOKIE)?.value);
}

/** Is this request served for a read-only account (whether or not it has chosen anything yet)? */
export function personalRequest(): boolean {
  const cookies = requestCookies();
  const role = cookies ? tokenRole(cookies) : null;
  return !!role && PERSONAL_ROLES.has(role);
}

/**
 * The personal value standing in for a shared context setting: a string to use instead, null when
 * the shared setting applies. `key` is any settings key; only the three context keys are affected.
 */
export function personalSetting(key: string): string | null {
  const field = KEYS[key as keyof typeof KEYS];
  if (!field) return null;
  const c = personalChoice();
  const v = c?.[field];
  return v ? String(v) : null;
}

/** Writes to the shared context from a read-only account's request are dropped (e.g. a period auto-pick). */
export function isSharedContextKey(key: string): boolean {
  return key in KEYS || /^current_(period|asset)_id:\d+$/.test(key);
}
