import ExcelJS from "exceljs";
import type { ReportData } from "./data";
import { sub } from "./excel";
import { loadKpi } from "../kpi/load";
import { MOVEMENT_LABEL, defaultPackName, type KpiItem } from "../kpi/model";
import { listKpiItemDetails } from "../kpi/store";
import { toDate } from "../format";
import { XL, MONEY_FMT, DATE_FMT, titleBlock, headerRow, totalRow } from "../xlsx-style";

/**
 * The one-click "F1 – Open VO Register" workbook for one report, laid out column for column like
 * the head office register (their column C onwards), so the rows paste straight in: the DVOs
 * approved in the month and every VO still waiting for its DVO, each with its movement since the
 * previous report; then a sheet of only what moved, and the DVOs approved on earlier reports for
 * reference.
 */
const HO_COLS = [
  "Please use this for Supported Docs File name",
  "S/N",
  "WEIGHT",
  "Month",
  "Program",
  "Project Name",
  "Asset Code.",
  "ACC Contract Ref.",
  "REEF PO Ref.",
  "Vendor Name",
  "Vendor Type",
  "Description",
  "CI / EI / VO Ref.",
  "Date of Instruction",
  "AVI / DVO Ref.",
  "Date of AVI / DVO Agreement",
  "Value of PVO (Planned)",
  "Value of AVV (Actual)",
  "No. of Calendar Days to Close AVV / DVO",
  "DVO Status",
  'Progress "OPEN" = 1 "CLOSED" = 0',
  "Deadline Date for Closing DVO (as per KPI norms)",
  "Remaining Days to Close Out",
  "F1",
  "F2",
  "Root cause of exceeding 90 Days (If applicable)",
  "Remarks/Observations and Requirements For F1/F2 criteria deviations",
  "Response by Program Lead",
  "Comments if any",
];

export function kpiRegisterSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const { kpi } = loadKpi(d.programme.id, d.period.id);
  const details = listKpiItemDetails(kpi.items.map((i) => i.changeId));
  const month = toDate(kpi.month);
  const lead = ["Dashboard item", "KPI category", "Movement vs previous report", "Movement note"];
  const cols = [...lead, ...HO_COLS];
  const widths = [12, 12, 24, 40, 44, 8, 8, 12, 12, 26, 14, 16, 12, 36, 12, 50, 16, 14, 16, 14, 18, 18, 14, 12, 12, 16, 14, 8, 8, 36, 36, 24, 24];
  const putRows = (ws: ExcelJS.Worksheet, items: KpiItem[], title: string, note: string) => {
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    titleBlock(ws, title, `${sub(d)} · ${note}`, 12);
    const h = headerRow(ws.addRow(cols), { height: 54 });
    h.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    for (const it of items) {
      const det = details.get(it.changeId);
      const sn = det?.sn ?? "";
      const closedNow = it.category === "closed";
      const row = ws.addRow([
        it.itemNo,
        it.category === "closed" ? "Closed KPI" : "Open KPI",
        MOVEMENT_LABEL[it.movement],
        it.movementNote,
        det?.file_name?.trim() || defaultPackName(it, sn),
        sn ? (Number.isFinite(Number(sn)) ? Number(sn) : sn) : "",
        closedNow ? 1 : "",
        closedNow ? month : "",
        it.program,
        it.projectName,
        it.assetCode,
        it.accContractRef,
        it.reefPo ? (Number.isFinite(Number(it.reefPo)) ? Number(it.reefPo) : it.reefPo) : "",
        it.vendor,
        it.vendorType,
        it.description,
        it.instructionRef,
        it.instructionDate ? toDate(it.instructionDate) : "",
        closedNow ? it.dvoRef : it.dvoRef ? `${it.dvoRef} (pending)` : 0,
        it.dvoDate ? toDate(it.dvoDate) : "",
        it.pvoValue ?? "",
        it.avvValue ?? (closedNow ? "" : 0),
        it.daysToClose ?? "TBC",
        it.dvoStatus,
        closedNow ? 0 : 1,
        it.deadline ? toDate(it.deadline) : "",
        it.remainingDays ?? "",
        it.f1 ?? "",
        it.f2 ?? "",
        det?.root_cause ?? (!closedNow && (it.remainingDays ?? 1) < 0 ? "To be completed – over 90 days" : ""),
        det?.remarks ?? "",
        "",
        "",
      ]);
      for (const c of [21, 22]) row.getCell(c).numFmt = MONEY_FMT;
      for (const c of [8, 18, 20, 26]) row.getCell(c).numFmt = DATE_FMT;
      row.getCell(29).numFmt = "0.0%";
      row.getCell(16).alignment = { wrapText: true, vertical: "top" };
      row.getCell(4).alignment = { wrapText: true, vertical: "top" };
      if (it.movement === "closed_now") row.getCell(3).font = { bold: true, color: { argb: XL.greenInk } };
      else if (it.movement === "new" || it.movement === "updated") row.getCell(3).font = { bold: true, color: { argb: XL.navy } };
      if (!closedNow && (it.remainingDays ?? 1) < 0) row.getCell(27).font = { bold: true, color: { argb: "FFB91C1C" } };
    }
    if (items.length) {
      const t = ws.addRow(["Total", "", `${items.length} entr${items.length === 1 ? "y" : "ies"}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", items.reduce((s, i) => s + (i.pvoValue ?? 0), 0), items.reduce((s, i) => s + (i.avvValue ?? 0), 0)]);
      t.getCell(21).numFmt = MONEY_FMT;
      t.getCell(22).numFmt = MONEY_FMT;
      totalRow(t);
    } else ws.addRow(["Nothing to report under this heading."]).font = { italic: true, color: { argb: XL.muted } };
    ws.views = [{ state: "frozen", xSplit: 5, ySplit: h.number }];
  };

  const ws = wb.addWorksheet("KPI_Register");
  putRows(ws, [...kpi.closed, ...kpi.open], `F1 – Open VO Register – ${d.programme.name} – ${d.period.label}`, `Closed KPI = DVO recorded as Approved on this report (${kpi.counts.closed}); Open KPI = PVO / VO recorded, DVO pending (${kpi.counts.open}, ${kpi.counts.open90} over 90 days) · columns E onward match the head office register from its column C${kpi.previousLabel ? ` · movement against ${kpi.previousLabel}` : " · no earlier report to compare with"}`);
  ws.addRow([]);
  ws.addRow(["Closed KPI: the DVO is recorded as Approved on this report – WEIGHT 1 and the report month, as the head office files it. Open KPI: a PVO or VO is recorded and the DVO is still pending – progress 1, deadline = instruction date + 90 days, remaining days counted to the report cut-off. The file name in column E is what the supporting-document pack is called; enter the head office S/N on the KPI Report page so it reads S/N_REEF PO_DVO_Vendor."]).font = { italic: true, size: 9, color: { argb: XL.muted } };
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, 12);
  ws.getRow(ws.rowCount).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(ws.rowCount).height = 54;

  const moved = kpi.items.filter((i) => i.movement !== "unchanged");
  putRows(wb.addWorksheet("Movement this report"), moved, `What moved since ${kpi.previousLabel ?? "the previous report"} – ${d.period.label}`, `${moved.length} entr${moved.length === 1 ? "y" : "ies"}: DVOs approved this report, new VOs / PVOs and changed values`);
  putRows(wb.addWorksheet("Closed earlier"), kpi.closedEarlier, `DVOs approved on earlier reports – for reference`, `${kpi.closedEarlier.length} entr${kpi.closedEarlier.length === 1 ? "y" : "ies"} already reported to the head office in earlier months`);
}
