/** What every "add from documents" flow reports back: what was written, what is a duplicate awaiting a decision, what each file was. */
export interface ReadValue {
  label: string;
  value: string;
  from: string;
}
export interface Duplicate {
  /** the key to answer with: decisions[key] = "replace" | "keep" */
  key: string;
  register?: string;
  existing: { id: number; label: string; detail: string };
  incoming: { label: string; detail: string };
  differences: { label: string; old: string; new: string }[];
  files: string[];
}
export interface Outcome {
  action: "created" | "updated" | "kept";
  /** the register written, when several are fed at once */
  register?: string;
  id: number;
  label: string;
  description: string;
  programme: string;
  files: string[];
  read: ReadValue[];
  missing: string[];
}
export interface FromDocsResult {
  entries: Outcome[];
  duplicates: Duplicate[];
  /** true when nothing was written because a duplicate needs a replace / keep decision first */
  needsDecision: boolean;
  files: { name: string; kind: string; note: string }[];
  periods: { programme: string; label: string; locked: string | null; opened: string | null; warning: string | null }[];
  warnings: string[];
}
export type Decisions = Record<string, "replace" | "keep">;
