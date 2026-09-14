import { getDb, getSetting, setSetting } from "./db";

/**
 * One switch for everything that calls the AI service and so costs money: reading documents as they
 * are added to a library, ASK ME, and the Claim EAR drafting. Turning it off leaves the dashboard
 * fully usable – documents are still filed from the references found in them, and every report,
 * summary and download is produced by the dashboard's own rules, which never call out to anything.
 *
 * On unless it has been turned off, so an existing installation behaves as it always did.
 */

const KEY = "ai_enabled";

export function aiEnabled(): boolean {
  return getSetting(getDb(), KEY) !== "off";
}

export function setAiEnabled(on: boolean) {
  setSetting(getDb(), KEY, on ? "on" : "off");
}

/** True when a key is present on the server, whatever the switch says. */
export function aiKeyPresent(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

/** Why the AI features are unavailable, phrased for the person reading it. */
export function aiOffReason(): string | null {
  if (!aiKeyPresent()) return "no key is set on the server (add ANTHROPIC_API_KEY in the hosting settings)";
  if (!aiEnabled()) return "the AI features have been switched off on the Customise my reports page";
  return null;
}
