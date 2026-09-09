import type { RegisterDef } from "./types";
import { settingsRegisters } from "./defs/settings";
import { projectSetupRegisters } from "./defs/project-setup";

/** Every register in the app, by key. Module registers get added here as modules are built. */
export const allRegisters: RegisterDef[] = [...settingsRegisters, ...projectSetupRegisters];

const byKey = new Map(allRegisters.map((d) => [d.key, d]));

export function getRegisterDef(key: string): RegisterDef | undefined {
  return byKey.get(key);
}

export { settingsRegisters };
