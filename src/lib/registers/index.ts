import type { RegisterDef } from "./types";
import { settingsRegisters } from "./defs/settings";
import { projectSetupRegisters } from "./defs/project-setup";
import { costReportRegisters } from "./defs/cost-report";
import { changeRegisters } from "./defs/changes";
import { claimRegisters } from "./defs/claims";
import { earlyWarningRegisters } from "./defs/early-warnings";
import { riskRegisters } from "./defs/risks";
import { provisionalSumRegisters } from "./defs/provisional-sums";
import { bondRegisters } from "./defs/bonds";
import { paymentRegisters } from "./defs/payments";
import { budgetTransferRegisters } from "./defs/budget-transfers";

/** Every register in the app, by key. Module registers get added here as modules are built. */
export const allRegisters: RegisterDef[] = [...settingsRegisters, ...projectSetupRegisters, ...costReportRegisters, ...changeRegisters, ...claimRegisters, ...earlyWarningRegisters, ...riskRegisters, ...provisionalSumRegisters, ...bondRegisters, ...paymentRegisters, ...budgetTransferRegisters];

const byKey = new Map(allRegisters.map((d) => [d.key, d]));

export function getRegisterDef(key: string): RegisterDef | undefined {
  return byKey.get(key);
}

export { settingsRegisters };
