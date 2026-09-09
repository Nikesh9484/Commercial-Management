import type { RegisterDef } from "../types";

/** Module 1 – Distribution list & project team, one list per programme. */
export const projectTeam: RegisterDef = {
  key: "project_team",
  table: "project_team",
  title: "Distribution & Project Team",
  singular: "Team member",
  description: "Who receives the monthly report and who holds each role on the programme.",
  displayField: "role",
  scope: "programme",
  defaultSort: { field: "sort_order", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "sort_order", label: "#", type: "number", defaultValue: 0, width: "4rem", help: "Order in the distribution list (lowest first)." },
    { key: "role", label: "Role / position", type: "text", required: true },
    { key: "name", label: "Name", type: "text" },
    { key: "organisation", label: "Organisation", type: "text" },
    { key: "email", label: "Email", type: "text", hideInTable: true },
    { key: "in_distribution", label: "On distribution", type: "boolean", defaultValue: true, help: "Receives the monthly report." },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const DEFAULT_TEAM_ROLES = [
  "Executive Commercial Director",
  "Senior Commercial Director",
  "Commercial Director",
  "Associate Commercial Director",
  "Project Delivery Directors",
  "Planning Director",
  "Design Manager",
  "Procurement Lead",
  "Commercial Manager",
];

export const projectSetupRegisters: RegisterDef[] = [projectTeam];
