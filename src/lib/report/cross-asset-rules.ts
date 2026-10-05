import { getDb, getSetting, setSetting } from "../db";

/**
 * The rules the cross-asset budget transfer report reads change entries by – kept on the dashboard, so they can be
 * changed without a new version: the list of assets (with their project codes and the other names they go by), the
 * rules each project uses (each project words its registers its own way – The Marina's "ACC Steps for BTR completed"
 * is its own internal BTR, not a transfer between assets), wording to look for, and entries placed by hand.
 */
export interface AssetRule {
  /** the name the report shows ("Marina Lifestyle Hotel (MLH)") */
  name: string;
  /** the three-digit project number in contract codes and references (006 in CN.006C22 and AMA01006-WTRAN-…), when there is one */
  code: string;
  /** other names it goes by, one per comma ("MLH, Marina Lifestyle, MLBC") – whole words, any case unless written in capitals */
  aliases: string;
  /** wording that names something else, not the asset ("Blue Wellness" is a subcontractor, not the Wellness asset) */
  notAliases?: string;
}

export type Dir = "out" | "into" | "confirm";
export type WorksDir = Dir | "off";

export interface ProjectRules {
  /** other names this project goes by (its short name and full name are always known) */
  ownAliases: string;
  /** transfers the entry names: "from AYC to VBH", "BTR from RSMLI", "Budget Transfer to 1TB04030…", "funds to be returned from MLH" */
  namedTransfers: boolean;
  /** a change on another asset's contract code (CN.011C38 on VBH's register) – that asset's contractor works for this project */
  contractCode: Dir | "off";
  /** a BTR or WTRAN reference raised under another asset's number (AMA01005-WTRAN-… on a Marina entry) */
  otherAssetRef: Dir | "off";
  /** "Works done in MLH", "(Works done under MLH)" */
  worksDone: WorksDir;
  /** works named for another asset alone: "… at MLH", "for RSMLI", "MLH – …", "… – RSMLI" */
  worksFor: WorksDir;
  /** the same, with a BTR the entry records as completed or approved */
  worksForWithBtr: WorksDir;
  /** another asset named beside this one: "Revised Hotel Rooms – MLH & VBH" */
  shared: WorksDir;
  /** entries the tracker marks as inter-asset (VBH's Schedule C shades them green): the list they go to when no rule names the direction */
  marked: Dir | "off";
  /** change categories that mark an entry as inter-asset when it names another asset or sits on another asset's contract code ("Back Charge") – one per comma */
  markCategories: string;
  /** when the report carries those marks, only marked entries are listed – the rest the rules find go under "Left out" */
  markedOnly: boolean;
  /** entries rejected, cancelled or superseded are left out (listed under "Left out") */
  skipCancelled: boolean;
  /** wording that is not a transfer between assets, taken out before the entry is read – one per line */
  ignoreWords: string;
  /** wording that puts an entry in a list – one per line; {asset} stands for any other asset's name, {own} for this project's */
  outPhrases: string;
  intoPhrases: string;
  confirmPhrases: string;
}

export interface Override {
  dir: Dir | "exclude";
  asset?: string;
  note?: string;
  by?: string;
  at?: string;
}

export interface CrossAssetConfig {
  assets: AssetRule[];
  /** by project code (1TB01006) */
  projects: Record<string, Partial<ProjectRules>>;
  /** by project code, then item number – item numbers stay the same from one import to the next */
  overrides: Record<string, Record<string, Override>>;
}

export const DEFAULT_ASSETS: AssetRule[] = [
  { name: "Amaala Yacht Club (AYC)", code: "003", aliases: "AYC, Yacht Club" },
  { name: "RSMLI", code: "005", aliases: "RSMLI" },
  { name: "Village Boutique Hotel (VBH)", code: "006", aliases: "VBH, Village Boutique, VBBC" },
  { name: "Wellness", code: "008", aliases: "Wellness", notAliases: "Blue Wellness, SPA Wellness" },
  { name: "Rosewood", code: "011", aliases: "Rosewood" },
  { name: "The Marina", code: "031", aliases: "The Marina" },
  { name: "Marina Village Wide", code: "100", aliases: "Marina Village Wide, Marina V. Wide, MVW, Marina Village Area" },
  { name: "Marina Lifestyle Hotel (MLH)", code: "", aliases: "MLH, Marina Lifestyle, MLBC" },
  { name: "MH-3", code: "", aliases: "MH3, MH-3" },
  { name: "Ritz-Carlton", code: "", aliases: "Ritz Carlton, Ritz-Carlton" },
  { name: "Corallium", code: "", aliases: "Corallium" },
  { name: "Non-Branded Residences", code: "", aliases: "Non-Branded Residences, Non Branded Residences" },
];

export const BASE_RULES: ProjectRules = {
  ownAliases: "",
  namedTransfers: true,
  contractCode: "out",
  otherAssetRef: "confirm",
  worksDone: "into",
  worksFor: "confirm",
  worksForWithBtr: "into",
  shared: "confirm",
  marked: "confirm",
  markCategories: "Back Charge",
  markedOnly: false,
  skipCancelled: true,
  ignoreWords: "",
  outPhrases: "",
  intoPhrases: "",
  confirmPhrases: "",
};

/** how each project words its register, as found in its reports */
export const PROJECT_DEFAULTS: Record<string, Partial<ProjectRules>> = {
  // The Marina: every DVO carries "ACC Steps for BTR completed" – the project's own budget steps, not a transfer between
  // assets; "INTER PROJECT ACC Steps for BTR" is one, with the other asset not named
  "1TB01031": {
    ownAliases: "Marina basin",
    ignoreWords: "WITHIN PROJECT ACC Steps for BTR\nINTERNAL ACC Steps for BTR\nACC Steps for BTR",
    confirmPhrases: "INTER PROJECT ACC Steps for BTR",
    // a BTR recorded on a Marina entry is usually the project's own (AMA01031-RBTR-…): works for another asset with
    // one are listed to confirm unless the BTR is named as from that asset ("BTR from RSMLI") or raised under its number
    worksForWithBtr: "confirm",
  },
  // VBH: Schedule C shades its inter-asset transfers green – those are the list; works VBH's contractors do for MLH and
  // other assets are funded back by that asset ("funds to be returned from MLH asset through inter asset transfer")
  "1TB01006": { ownAliases: "Hijaz Island", markedOnly: true, worksFor: "into", shared: "confirm" },
  "1TB01003": {},
};

const KEY = "cross_asset_rules";

export function loadCrossAssetConfig(): CrossAssetConfig {
  let saved: Partial<CrossAssetConfig> = {};
  try {
    saved = JSON.parse(getSetting(getDb(), KEY) ?? "{}") as Partial<CrossAssetConfig>;
  } catch {
    saved = {};
  }
  return {
    assets: Array.isArray(saved.assets) && saved.assets.length ? saved.assets : DEFAULT_ASSETS,
    projects: saved.projects && typeof saved.projects === "object" ? saved.projects : {},
    overrides: saved.overrides && typeof saved.overrides === "object" ? saved.overrides : {},
  };
}

export function saveCrossAssetConfig(c: CrossAssetConfig): void {
  setSetting(getDb(), KEY, JSON.stringify(c));
}

/** a project's rules: what was saved for it over its defaults over the base */
export function rulesFor(c: CrossAssetConfig, projectCode: string): ProjectRules {
  return { ...BASE_RULES, ...(PROJECT_DEFAULTS[projectCode] ?? {}), ...(c.projects[projectCode] ?? {}) };
}

/** the defaults a project's rules go back to */
export function defaultRulesFor(projectCode: string): ProjectRules {
  return { ...BASE_RULES, ...(PROJECT_DEFAULTS[projectCode] ?? {}) };
}

const DIRS = ["out", "into", "confirm", "off"];
/** a rules form as sent from the page, checked field by field */
export function cleanRules(input: Record<string, unknown>): Partial<ProjectRules> {
  const out: Partial<ProjectRules> = {};
  const text = (k: keyof ProjectRules) => {
    if (typeof input[k] === "string") (out as Record<string, unknown>)[k] = String(input[k]).slice(0, 4000);
  };
  const flag = (k: keyof ProjectRules) => {
    if (typeof input[k] === "boolean") (out as Record<string, unknown>)[k] = input[k];
  };
  const dir = (k: keyof ProjectRules, allowOff = true) => {
    const v = String(input[k] ?? "");
    if (DIRS.includes(v) && (allowOff || v !== "off")) (out as Record<string, unknown>)[k] = v;
  };
  text("ownAliases");
  text("ignoreWords");
  text("outPhrases");
  text("intoPhrases");
  text("confirmPhrases");
  text("markCategories");
  flag("namedTransfers");
  flag("skipCancelled");
  flag("markedOnly");
  dir("marked");
  dir("contractCode");
  dir("otherAssetRef");
  dir("worksDone");
  dir("worksFor");
  dir("worksForWithBtr");
  dir("shared");
  return out;
}

export function cleanAssets(input: unknown): AssetRule[] | null {
  if (!Array.isArray(input)) return null;
  const list = input
    .map((a) => ({
      name: String((a as AssetRule)?.name ?? "").trim().slice(0, 80),
      code: String((a as AssetRule)?.code ?? "").trim().replace(/\D/g, "").slice(0, 3),
      aliases: String((a as AssetRule)?.aliases ?? "").trim().slice(0, 400),
      notAliases: String((a as AssetRule)?.notAliases ?? "").trim().slice(0, 400),
    }))
    .filter((a) => a.name);
  return list.length ? list : null;
}
