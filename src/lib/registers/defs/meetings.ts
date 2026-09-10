import type { RegisterDef } from "../types";

export const ACTION_STATUSES = ["Open", "In progress", "Closed"];

export const meetings: RegisterDef = {
  key: "meetings",
  table: "meetings",
  title: "Minutes of Meeting",
  singular: "Meeting",
  description: "Commercial meetings. Open items from earlier meetings are carried forward automatically.",
  displayField: "title",
  displayFields: ["meeting_no", "title"],
  scope: "programme",
  rowLinkTemplate: "/modules/executive-summary/minutes/{id}",
  rowLinkLabel: "Open minutes",
  defaultSort: { field: "meeting_date", dir: "desc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "meeting_no", label: "Meeting No", type: "text", required: true, unique: true, width: "7rem", help: "e.g. CM-12. Used as the prefix of item numbers." },
    { key: "title", label: "Title", type: "text", required: true, defaultValue: "Monthly Commercial Meeting" },
    { key: "meeting_date", label: "Meeting date", type: "date", required: true },
    { key: "period_id", label: "Reporting period", type: "lookup", lookup: { register: "reporting_periods" }, filter: true },
    { key: "venue", label: "Venue / link", type: "text", hideInTable: true },
    { key: "chair", label: "Chair", type: "text" },
    { key: "attendees", label: "Attendees", type: "textarea", help: "One per line or comma separated." },
    { key: "apologies", label: "Apologies", type: "textarea", hideInTable: true },
    { key: "notes", label: "General notes", type: "textarea", hideInTable: true },
  ],
};

export const actions: RegisterDef = {
  key: "actions",
  table: "actions",
  title: "Meeting Items & Actions",
  singular: "Item",
  description: "Items discussed and actions agreed. An item stays on every following meeting until it is closed.",
  displayField: "item_no",
  displayFields: ["item_no", "topic"],
  scope: "programme",
  defaultSort: { field: "item_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "meeting_id", label: "Raised at meeting", type: "lookup", lookup: { register: "meetings" }, filter: true, help: "Leave blank for an action raised outside a meeting (e.g. from the dashboard)." },
    { key: "item_no", label: "Item No", type: "text", unique: true, width: "6rem", help: "Leave blank to number automatically (meeting no + sequence)." },
    { key: "topic", label: "Topic", type: "text", required: true },
    { key: "discussion", label: "Discussion", type: "textarea", hideInTable: true },
    { key: "action", label: "Action", type: "textarea", required: true },
    { key: "owner", label: "Owner", type: "text", filter: false },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "status", label: "Status", type: "select", options: ACTION_STATUSES, required: true, defaultValue: "Open", chip: true, filter: true },
    { key: "days_to_due", label: "Days to due", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Negative = overdue (red)." },
    { key: "closed_date", label: "Closed date", type: "date", hideInTable: true },
    { key: "update", label: "Latest update", type: "textarea", hideInTable: true, help: "Progress note carried with the item to the next meeting." },
  ],
};

export const meetingRegisters: RegisterDef[] = [meetings, actions];
