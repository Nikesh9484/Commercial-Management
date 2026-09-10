import type { RegisterDef } from "./types";
import { settingsRegisters } from "./defs/settings";
import { projectSetupRegisters } from "./defs/project-setup";
import { costReportRegisters } from "./defs/cost-report";
import { changeRegisters } from "./defs/changes";
import { claimRegisters } from "./defs/claims";
import { earlyWarningRegisters } from "./defs/early-warnings";
import { riskRegisters } from "./defs/risks";

/** Every register in the app, by key. Module registers get added here as modules are built. */
export const allRegisters: RegisterDef[] = [...settingsRegisters, ...projectSetupRegisters, ...costReportRegisters, ...changeRegisters, ...claimRegisters, ...earlyWarningRegisters, ...riskRegisters];

const byKey = new Map(allRegisters.map((d) => [d.key, d]));

export function getRegisterDef(key: string): RegisterDef | undefined {
  return byKey.get(key);
}

export { settingsRegisters };
