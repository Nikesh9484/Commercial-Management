import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatMoney, formatDate } from "../format";
import { daysBetween } from "../registers/enrich-utils";

/**
 * Executive Invoice & Payment Status Report: where every contract stands on certification and payment,
 * how much cash is held back, how the team performs against the contractual timetable, and what needs
 * attention – with a narrative written from the data, as in the Claims and Final Account reports.
 */
export interface PaymentLine {
  po: string;
  contractor: string;
  package: string;
  scope: string;
  status: string;
  revised: number;
  claimed: number;
  certified: number;
  pctCertified: number | null;
  balanceToCertify: number;
  netPaid: number;
  awaitingCertification: number;
  awaitingPayment: number;
  retentionHeld: number;
  advanceRecovered: number;
  applications: number;
  lastApplication: string | null;
  lastCertificate: string | null;
  daysSinceLastCertificate: number | null;
  avgDaysToCertify: number | null;
  avgDaysToPay: number | null;
  lateCertificates: number;
  latePayments: number;
}

export interface PaymentContractorLine {
  contractor: string;
  contracts: number;
  revised: number;
  certified: number;
  netPaid: number;
  retentionHeld: number;
  awaitingPayment: number;
  pctCertified: number | null;
  pctPaid: number | null;
}

export interface PaymentOverdueLine {
  po: string;
  contractor: string;
  application: string;
  applicationDate: string | null;
  ipcDate: string | null;
  dueDate: string | null;
  daysLate: number | null;
  amount: number;
  stage: "Certification" | "Payment";
}

export interface PaymentAgeBucket {
  bucket: string;
  n: number;
  value: number;
}

export interface PaymentsReport {
  title: string;
  asOf: string;
  headline: {
    contracts: number;
    contractors: number;
    revised: number;
    claimed: number;
    certified: number;
    pctCertified: number | null;
    netApplied: number;
    netPaid: number;
    pctPaid: number | null;
    balanceToCertify: number;
    awaitingCertification: number;
    awaitingPayment: number;
    retentionHeld: number;
    advanceRecovered: number;
    applications: number;
    certifiedThisPeriod: number;
    paidThisPeriod: number;
    avgDaysToCertify: number | null;
    avgDaysToPay: number | null;
    onTimeCertification: number | null;
    onTimePayment: number | null;
    lateCertificates: number;
    latePayments: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  contracts: PaymentLine[];
  byContractor: PaymentContractorLine[];
  overdue: PaymentOverdueLine[];
  ageing: PaymentAgeBucket[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = (n: number) => `SAR ${formatMoney(n)}`;
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const list = (items: string[], max = 4) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null);

export function buildPaymentsReport(data: ReportData): PaymentsReport {
  const contractRows = (data.registers.contracts?.rows ?? []) as RecordRow[];
  const appRows = (data.registers.payment_applications?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  // "this period" runs from the day after the previous report's cut-off, unless the period states its own start
  const dayAfter = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const periodStart = (data.period.period_start as string | null) ?? dayAfter(data.previousPeriod?.period_end ?? null);
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const appsByContract = new Map<number, RecordRow[]>();
  for (const a of appRows) {
    const k = Number(a.contract_id);
    const g = appsByContract.get(k);
    if (g) g.push(a);
    else appsByContract.set(k, [a]);
  }

  const overdue: PaymentOverdueLine[] = [];
  const ageBuckets: [string, number, number][] = [
    ["Up to 30 days", 0, 30],
    ["31 to 60 days", 31, 60],
    ["61 to 90 days", 61, 90],
    ["More than 90 days", 91, Infinity],
  ];
  const unpaid: { days: number; value: number }[] = [];
  const certifyDays: number[] = [];
  const payDays: number[] = [];
  let onTimeCert = 0;
  let certJudged = 0;
  let onTimePay = 0;
  let payJudged = 0;
  let certifiedThisPeriod = 0;
  let paidThisPeriod = 0;

  const inPeriod = (d: string | null) => !!d && d <= asOf && !!periodStart && d >= periodStart;

  const contracts: PaymentLine[] = contractRows.map((c) => {
    const mine = (appsByContract.get(Number(c.id)) ?? []).slice().sort((a, b) => txt(a.application_date).localeCompare(txt(b.application_date)));
    const po = txt(c.reef_po_no) || txt(c.acc_ref) || `#${c.id}`;
    const contractor = txt(c.contractor_id__label);
    let retention = 0;
    let advance = 0;
    let awaitingCert = 0;
    let awaitingPay = 0;
    let lateCert = 0;
    let latePay = 0;
    let lastApplication: string | null = null;
    let lastCertificate: string | null = null;
    const myCertifyDays: number[] = [];
    const myPayDays: number[] = [];

    for (const a of mine) {
      const appDate = txt(a.application_date) || null;
      const ipcDate = txt(a.ipc_date) || null;
      const paidDate = txt(a.paid_date) || null;
      if (appDate && (!lastApplication || appDate > lastApplication)) lastApplication = appDate;
      if (ipcDate && (!lastCertificate || ipcDate > lastCertificate)) lastCertificate = ipcDate;
      retention += num(a.retention_certified);
      advance += Math.abs(num(a.advance_recovery_certified));
      if (ipcDate && inPeriod(ipcDate)) certifiedThisPeriod += num(a.gross_certified_month);
      if (paidDate && inPeriod(paidDate)) paidThisPeriod += num(a.net_payment);

      if (appDate && ipcDate) {
        const d = daysBetween(appDate, ipcDate);
        if (d >= 0 && d < 400) {
          myCertifyDays.push(d);
          certifyDays.push(d);
        }
        const late = numOrNull(a.ipc_days_late);
        if (late !== null) {
          certJudged++;
          if (late <= 0) onTimeCert++;
          else lateCert++;
        }
      }
      if (ipcDate && paidDate) {
        const d = daysBetween(ipcDate, paidDate);
        if (d >= 0 && d < 400) {
          myPayDays.push(d);
          payDays.push(d);
        }
        const late = numOrNull(a.payment_days_late);
        if (late !== null) {
          payJudged++;
          if (late <= 0) onTimePay++;
          else latePay++;
        }
      }
      // open items: applied but not certified, certified but not paid
      if (appDate && !ipcDate) {
        const v = num(a.net_claimed);
        awaitingCert += v;
        if (txt(a.ipc_due_date) && txt(a.ipc_due_date) < asOf) {
          overdue.push({ po, contractor, application: txt(a.application_no) || txt(a.ipc_no) || `#${a.id}`, applicationDate: appDate, ipcDate: null, dueDate: txt(a.ipc_due_date), daysLate: daysBetween(txt(a.ipc_due_date), asOf), amount: v, stage: "Certification" });
        }
      }
      if (ipcDate && !paidDate) {
        const v = num(a.net_certified);
        awaitingPay += v;
        unpaid.push({ days: daysBetween(ipcDate, asOf), value: v });
        if (txt(a.payment_due_date) && txt(a.payment_due_date) < asOf) {
          overdue.push({ po, contractor, application: txt(a.application_no) || txt(a.ipc_no) || `#${a.id}`, applicationDate: appDate, ipcDate, dueDate: txt(a.payment_due_date), daysLate: daysBetween(txt(a.payment_due_date), asOf), amount: v, stage: "Payment" });
        }
      }
    }

    const revised = num(c.revised_contract_value);
    const certified = num(c.latest_cum_certified);
    return {
      po,
      contractor,
      package: txt(c.package_id__label) || txt(c.cost_line_id__label),
      scope: txt(c.scope_of_work) || txt(c.title),
      status: txt(c.current_status) || "–",
      revised,
      claimed: num(c.latest_cum_claimed),
      certified,
      pctCertified: revised > 0 ? Math.round((certified / revised) * 1000) / 10 : null,
      balanceToCertify: Math.round((revised - certified) * 100) / 100,
      netPaid: num(c.cum_paid),
      awaitingCertification: Math.round(awaitingCert * 100) / 100,
      awaitingPayment: Math.round(awaitingPay * 100) / 100,
      retentionHeld: Math.round(retention * 100) / 100,
      advanceRecovered: Math.round(advance * 100) / 100,
      applications: mine.length,
      lastApplication,
      lastCertificate,
      daysSinceLastCertificate: lastCertificate ? daysBetween(lastCertificate, asOf) : null,
      avgDaysToCertify: avg(myCertifyDays),
      avgDaysToPay: avg(myPayDays),
      lateCertificates: lateCert,
      latePayments: latePay,
    };
  });

  contracts.sort((a, b) => b.revised - a.revised);
  overdue.sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || b.amount - a.amount);

  const sum = (f: (l: PaymentLine) => number) => Math.round(contracts.reduce((t, l) => t + f(l), 0) * 100) / 100;
  const revised = sum((l) => l.revised);
  const certified = sum((l) => l.certified);
  const claimed = sum((l) => l.claimed);
  const netPaid = sum((l) => l.netPaid);
  const retentionHeld = sum((l) => l.retentionHeld);
  const advanceRecovered = sum((l) => l.advanceRecovered);
  const awaitingCertification = sum((l) => l.awaitingCertification);
  const awaitingPayment = sum((l) => l.awaitingPayment);
  const netApplied = Math.round(contractRows.reduce((t, c) => t + num(c.net_cum_applied), 0) * 100) / 100;
  const contractorsSet = new Set(contracts.map((l) => l.contractor).filter(Boolean));

  const ageing: PaymentAgeBucket[] = ageBuckets.map(([bucket, lo, hi]) => {
    const inBand = unpaid.filter((u) => u.days >= lo && u.days <= hi);
    return { bucket, n: inBand.length, value: Math.round(inBand.reduce((t, u) => t + u.value, 0) * 100) / 100 };
  });

  const byC = new Map<string, PaymentContractorLine>();
  for (const l of contracts) {
    const k = l.contractor || "(no contractor)";
    const row = byC.get(k) ?? { contractor: k, contracts: 0, revised: 0, certified: 0, netPaid: 0, retentionHeld: 0, awaitingPayment: 0, pctCertified: null, pctPaid: null };
    row.contracts++;
    row.revised += l.revised;
    row.certified += l.certified;
    row.netPaid += l.netPaid;
    row.retentionHeld += l.retentionHeld;
    row.awaitingPayment += l.awaitingPayment;
    byC.set(k, row);
  }
  const byContractor = [...byC.values()]
    .map((r) => ({ ...r, pctCertified: r.revised > 0 ? Math.round((r.certified / r.revised) * 1000) / 10 : null, pctPaid: r.certified > 0 ? Math.round((r.netPaid / r.certified) * 1000) / 10 : null }))
    .sort((a, b) => b.revised - a.revised);

  const headline: PaymentsReport["headline"] = {
    contracts: contracts.length,
    contractors: contractorsSet.size,
    revised,
    claimed,
    certified,
    pctCertified: revised > 0 ? Math.round((certified / revised) * 1000) / 10 : null,
    netApplied,
    netPaid,
    pctPaid: certified > 0 ? Math.round((netPaid / certified) * 1000) / 10 : null,
    balanceToCertify: Math.round((revised - certified) * 100) / 100,
    awaitingCertification,
    awaitingPayment,
    retentionHeld,
    advanceRecovered,
    applications: appRows.length,
    certifiedThisPeriod: Math.round(certifiedThisPeriod * 100) / 100,
    paidThisPeriod: Math.round(paidThisPeriod * 100) / 100,
    avgDaysToCertify: avg(certifyDays),
    avgDaysToPay: avg(payDays),
    onTimeCertification: certJudged ? Math.round((onTimeCert / certJudged) * 100) : null,
    onTimePayment: payJudged ? Math.round((onTimePay / payJudged) * 100) : null,
    lateCertificates: contracts.reduce((t, l) => t + l.lateCertificates, 0),
    latePayments: contracts.reduce((t, l) => t + l.latePayments, 0),
  };

  // movement since the previous report
  const mv = data.movement;
  const grpC = mv?.groups.find((g) => g.key === "contracts");
  const grpA = mv?.groups.find((g) => g.key === "payment_applications");
  const movement =
    mv?.previous && (grpC || grpA)
      ? {
          label: `Since ${mv.previous.label}`,
          items: [
            ...(grpC?.changed ?? []).map((i) => `${i.key} ${i.title}: cumulative certified ${i.delta && i.delta > 0 ? "+" : ""}${formatMoney(i.delta ?? 0)}`),
            ...(grpA?.added ?? []).map((i) => `New application: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)} cumulative claimed)` : ""}`),
            ...(grpA?.changed ?? []).map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}`),
            ...(grpC?.added ?? []).map((i) => `New contract: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`),
          ].slice(0, 40),
        }
      : null;

  // items requiring attention
  const attention: string[] = [];
  const overdueCert = overdue.filter((o) => o.stage === "Certification");
  const overduePay = overdue.filter((o) => o.stage === "Payment");
  if (overduePay.length) attention.push(`${plural(overduePay.length, "certificate")} past the contractual payment date, ${money(overduePay.reduce((t, o) => t + o.amount, 0))} net (${list(overduePay.map((o) => `${o.po} ${o.application}`))}) – late payment interest is a risk.`);
  if (overdueCert.length) attention.push(`${plural(overdueCert.length, "payment application")} past the contractual certification date, ${money(overdueCert.reduce((t, o) => t + o.amount, 0))} net (${list(overdueCert.map((o) => `${o.po} ${o.application}`))}) – the Engineer's certificate is overdue.`);
  const over100 = contracts.filter((l) => l.pctCertified !== null && l.pctCertified > 100);
  if (over100.length) attention.push(`${plural(over100.length, "contract")} certified beyond the revised contract value (${list(over100.map((l) => `${l.po} at ${l.pctCertified}%`))}) – the variation account or the final account needs to catch up with what has been certified.`);
  const stale = contracts.filter((l) => l.applications > 0 && (l.daysSinceLastCertificate ?? 0) > 90 && l.pctCertified !== null && l.pctCertified < 100);
  if (stale.length) attention.push(`${plural(stale.length, "live contract")} with no certificate for more than 90 days (${list(stale.map((l) => l.po))}) – confirm whether work has stopped or certification has stalled.`);
  const noApps = contracts.filter((l) => l.applications === 0 && l.revised > 0);
  if (noApps.length) attention.push(`${plural(noApps.length, "contract")} with no payment application at all (${list(noApps.map((l) => l.po))}) – ${money(noApps.reduce((t, l) => t + l.revised, 0))} of contract value not yet drawn against.`);
  if (retentionHeld > 0) attention.push(`${money(retentionHeld)} of retention is held across the portfolio – plan the release against the completion certificates.`);

  // narrative
  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      contracts.length === 0
        ? `No contracts are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(contracts.length, "contract")} with ${plural(headline.contractors, "contractor")} carry a revised value of ${money(revised)} against ${assetName}. Contractors have applied for ${money(claimed)} and ${money(certified)} has been certified, ${headline.pctCertified ?? 0}% of the revised value, ${headline.balanceToCertify >= 0 ? `leaving ${money(headline.balanceToCertify)} still to certify` : `which is ${money(Math.abs(headline.balanceToCertify))} beyond the revised value – the variation or final account has yet to catch up with what has been certified`}. Of the certified amount ${money(netPaid)} has been released net of deductions (${headline.pctPaid ?? 0}%), with ${money(retentionHeld)} held as retention and ${money(advanceRecovered)} of advance payment recovered. ${
            awaitingPayment || awaitingCertification
              ? `${money(awaitingPayment)} sits certified and awaiting payment${awaitingCertification ? `, and a further ${money(awaitingCertification)} has been applied for and is awaiting certification` : ""}.`
              : "Nothing is outstanding between certification and payment."
          }`,
  });
  if (mv?.previous) {
    const n = (grpC?.changed.length ?? 0) + (grpA?.added.length ?? 0) + (grpA?.changed.length ?? 0);
    narrative.push({
      heading: `Movement since ${mv.previous.label}`,
      text:
        n === 0 && !headline.certifiedThisPeriod
          ? `No certificates or payments were recorded in the register since ${mv.previous.label}.`
          : `${headline.certifiedThisPeriod ? `${money(headline.certifiedThisPeriod)} was certified in the period` : periodStart ? "Nothing new was certified in the period" : "The period's own certification total cannot be measured (the report has no start date)"}${headline.paidThisPeriod ? ` and ${money(headline.paidThisPeriod)} was released to contractors` : ""}. ${grpA?.added.length ? `${plural(grpA.added.length, "new payment application")} ${grpA.added.length === 1 ? "was" : "were"} received (${list(grpA.added.map((i) => i.key))}). ` : ""}${grpC?.changed.length ? `${plural(grpC.changed.length, "contract")} moved on certified value (${list(grpC.changed.map((i) => i.key))}). ` : ""}${grpC?.added.length ? `${plural(grpC.added.length, "contract")} entered the register. ` : ""}`.trim(),
    });
  }
  narrative.push({
    heading: "Certification and payment performance",
    text:
      headline.avgDaysToCertify === null && headline.avgDaysToPay === null
        ? "No certificate or payment dates are recorded yet, so performance against the contractual timetable cannot be measured."
        : `Certificates are issued on average ${headline.avgDaysToCertify ?? "–"} days after the application${headline.onTimeCertification !== null ? `, with ${headline.onTimeCertification}% inside the contractual period` : ""}; payments follow on average ${headline.avgDaysToPay ?? "–"} days after the certificate${headline.onTimePayment !== null ? `, ${headline.onTimePayment}% of them on time` : ""}. ${
            headline.lateCertificates || headline.latePayments
              ? `${plural(headline.lateCertificates, "certificate")} and ${plural(headline.latePayments, "payment")} were issued later than the contract allows${overduePay.length ? `, and ${plural(overduePay.length, "certificate")} ${overduePay.length === 1 ? "is" : "are"} overdue for payment today` : ""}.`
              : "Nothing has fallen outside the contractual timetable."
          }`,
  });
  if (awaitingPayment > 0) {
    const worst = ageing.filter((b) => b.n > 0).slice(-1)[0];
    narrative.push({
      heading: "Cash outstanding",
      text: `${money(awaitingPayment)} is certified and unpaid across ${plural(unpaid.length, "certificate")}. ${ageing.map((b) => `${b.bucket.toLowerCase()}: ${b.n} (${formatMoney(b.value)})`).join("; ")}.${worst && /90/.test(worst.bucket) ? " The oldest band should be cleared with Finance before the next report." : ""}`,
    });
  }
  narrative.push({
    heading: "Outlook and recommended actions",
    text:
      contracts.length === 0
        ? "No action is required until the first contract is recorded."
        : `The commercial team's priorities are to ${[
            overdueCert.length ? "issue the overdue certificates" : "",
            overduePay.length ? "release the certificates already past their payment date" : "",
            over100.length ? "regularise the contracts certified beyond their revised value through the change or final account process" : "",
            stale.length ? "re-establish the certification cycle on the dormant contracts" : "",
            retentionHeld ? "agree the retention release programme against completion" : "",
          ]
            .filter(Boolean)
            .join(", ") || "maintain the current certification and payment cycle"}. ${headline.balanceToCertify >= 0 ? `${money(headline.balanceToCertify)} of contract value remains to be certified, which sets the floor for the cash requirement to completion.` : `Certification currently exceeds the revised contract value by ${money(Math.abs(headline.balanceToCertify))}, so the contract sums must be brought up to date before the position can be relied on.`}`,
  });

  return {
    title: `Invoice & Payment Status Report – ${data.period.label}`,
    asOf,
    headline,
    narrative,
    movement,
    attention,
    contracts,
    byContractor,
    overdue,
    ageing,
  };
}
