import { getDb, getSetting, setSetting } from "../db";
import { requestBackup } from "../cloud-backup";

/**
 * One-off (5 Oct 2026): the same company under several names – the Yacht Club's workbook import made a
 * contractor out of every short code on its schedules ("Mas", "Kaa", "Cml", "Baytur", "Alutec"), the
 * document readers out of every spelling ("HKS Architects Limited" / "Ltd" / "Design Consultant"), and a
 * few line names became "contractors" of their own. Each group is folded into one entry: every row that
 * pointed at a duplicate points at the kept one, the duplicate goes. Likewise the bond types typed with
 * "&" and "and". Nothing else about the rows changes.
 */
const CONTRACTORS: { keep: string; rename?: string; drop: string[] }[] = [
  { keep: "MME – Majestic Marine Engineering LLC", drop: ["MME Engg"] },
  { keep: "Abdulaziz Al Raqtan and Partners Company for Trading and Industry Company", drop: ["Abdulaziz Al Raqtan & Partners Company for Trading & Industry"] },
  { keep: "Abu Dhabi Precast LLC", drop: ["Abu Dhabi Precast"] },
  { keep: "Alfanar Company", drop: ["Al Fanar - MEP Labour Supply"] },
  { keep: "Al Futtaim Pioneer Elevators - Al Futtaim Pioneer", rename: "Al Futtaim Pioneer Elevators", drop: ["Al Futtaim"] },
  { keep: "Aluminium Technology Auxiliary Industries (Alutec) WLL", drop: ["Aluminium Technology Auxiliary Industries (ALUTEC)", "Alutec", "FaçAde & Glazing Works"] },
  { keep: "Applied Technology and Management Inc (Dubai BR)", drop: ["Applied Techn & Management"] },
  { keep: "Areen Design Limited", drop: ["Areen Design", "AREEN Design LTD"] },
  { keep: "Mas Engineering & Construction Company Ltd", drop: ["Mas", "MAS - Amphitheatre"] },
  { keep: "CML International Saudi LLC", drop: ["Cml"] },
  { keep: "DEPA Saudi Arabia for Contracting and Interior Decoration Co. Ltd", drop: ["DEPA Interior Fitout"] },
  { keep: "Elevator Systems Contracting Company (ESCCO)", drop: ["ESCCO - Vertical Transport"] },
  { keep: "Euro Consult For Engineering Consultancy", drop: ["EURO CONSULT (Accommodation & Transporation)"] },
  { keep: "GST Building Energy Efficiency Services", drop: ["GST - Sustainability Accreditation Services"] },
  { keep: "Green Business Certification Inc", drop: ["Gbc"] },
  { keep: "HKS Architects Ltd", drop: ["HKS Architects Limited", "HKS Architects Ltd - Design Architect Fees", "HKS Design Consultant"] },
  { keep: "Jensen Hughes Saudi Arabia, LLC", drop: ["Jensen Hughes", "JensenHuges"] },
  { keep: "KAUST – King Abdullah University of Science & Technology", drop: ["King Abdullah University of Science and Technology (KA UST)"] },
  { keep: "Saudi Consolidated Engineering Company - Khatib & Alami", drop: ["Khatib & Alami", "Kaa"] },
  { keep: "KTH - MEP Works Package - 2240072 - KORTEK", rename: "Kortek (KTH)", drop: ["Kortec"] },
  { keep: "Langan International UK LTD", drop: ["Langan", "Liu"] },
  { keep: "Medtel WN WLL", drop: ["Medtel", "Medtel - W.N"] },
  { keep: "NSCC International Saudi Contracting", drop: ["NSCC - Piling Contractor", "Nscc"] },
  { keep: "Saudi Arabian Baytur Construction Company", drop: ["Saudi Arabian Baytur", "Baytur", "Sab", "SAB - Civil and Arch Works, MEPD & ICT/ELV"] },
  { keep: "Shandong Tiejun Electric Power Engineering Co. LTD. Branch", drop: ["Teijun"] },
  { keep: "Soil Improvement Contracting Company", drop: ["SOI TB Ground Improvement Works", "SOI TB Ground Improvement Works (PS)"] },
  { keep: "Zuhair Fayez Partnership Consultants (ZFP)", drop: ["Zuhair Fayez & Partners"] },
  { keep: "Sevenrooms Inc", drop: ["Seven Rooms Reservation System"] },
  { keep: "Al Saad General Contracting Co. Ltd.", drop: ["Al Saad General Contracting Co.Ltd. (Jetty Works Package)"] },
  { keep: "Al Rajhi Company for Cooperative Insurance", drop: ["Al Rajhi Takaful (Insurance)", "RJT - OCIP Insurance Premium - Declaration 11"] },
  { keep: "WSP Middle East", drop: ["WSP Consulting"] },
  { keep: "Uraqa Al-Banaa Walemar Al-Hadeeth Company for Contracting", drop: ["Uraqa Al-Banaa Walemar Al-Hadeeth Company (Noble)"] },
  { keep: "Al Salama Company for Aluminium and Plastic", drop: ["WELLNESS -Al Salama Company for Aluminium and Plastic"] },
  { keep: "Tabuk Investment and Tourism Company (Enviro Facility Management)", drop: ["Enviro - Deep Cleaning"] },
  { keep: "ALC - Alcatop Package - Fourseasons - Alcatop", rename: "Alcatop", drop: ["Alcatop"] },
  { keep: "Fibrex Mh3", rename: "Fibrex LLC", drop: [] },
  { keep: "Imar Mh3", rename: "IMAR Overseas Saudi Arabia Co. W.L.L.", drop: [] },
];
/** "contractors" that are no company at all – a number, a placeholder, a cost line's name: the rows lose the link, the entry goes */
const NOT_CONTRACTORS = ["14", "New Contractor", "Loose FF&E Items (FOH)", "Extraordinary Cart"];
const BOND_TYPES: { keep: string; drop: string[] }[] = [
  { keep: "Workmen's Compensation", drop: ["Workmen’s Compensation"] },
  { keep: "Plant & Equipment", drop: ["Plant and Equipment"] },
  { keep: "Marine & Hull", drop: ["MARINE HULL", "Marine and Hull"] },
  { keep: "Protection & Indemnity", drop: ["PROTECTION AND INDEMNITY"] },
];

function refColumns(table: string, column: string): { table: string }[] {
  const db = getDb();
  const out: { table: string }[] = [];
  // a bond type is referred to by the bonds alone; a contractor by every register with a contractor_id
  const only = table === "bond_types" ? ["bonds"] : null;
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
    if (t.name === table || (only && !only.includes(t.name))) continue;
    const cols = (db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map((c) => c.name);
    if (cols.includes(column)) out.push({ table: t.name });
  }
  return out;
}

function fold(table: string, column: string, groups: { keep: string; rename?: string; drop: string[] }[], label: string): number {
  const db = getDb();
  const refs = refColumns(table, column);
  const byName = (name: string) => db.prepare(`SELECT id FROM "${table}" WHERE lower(trim(name)) = lower(trim(?))`).get(name) as { id: number } | undefined;
  let folded = 0;
  for (const g of groups) {
    const keep = byName(g.keep);
    if (!keep) continue;
    for (const name of g.drop) {
      const d = byName(name);
      if (!d || d.id === keep.id) continue;
      let moved = 0;
      for (const r of refs) moved += db.prepare(`UPDATE "${r.table}" SET ${column} = ? WHERE ${column} = ?`).run(keep.id, d.id).changes;
      db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(d.id);
      console.log(`[merge] ${label} "${name}" folded into "${g.rename ?? g.keep}" (${moved} row(s) re-pointed).`);
      folded++;
    }
    if (g.rename && !byName(g.rename)) db.prepare(`UPDATE "${table}" SET name = ? WHERE id = ?`).run(g.rename, keep.id);
  }
  return folded;
}

export function mergeDuplicateLookups(): void {
  const db = getDb();
  if (getSetting(db, "merged_duplicates_v1") === "1") return;
  setSetting(db, "merged_duplicates_v1", "1");
  let changed = 0;
  try {
    db.transaction(() => {
      changed += fold("contractors", "contractor_id", CONTRACTORS, "contractor");
      const refs = refColumns("contractors", "contractor_id");
      for (const name of NOT_CONTRACTORS) {
        const d = db.prepare("SELECT id FROM contractors WHERE lower(trim(name)) = lower(trim(?))").get(name) as { id: number } | undefined;
        if (!d) continue;
        for (const r of refs) db.prepare(`UPDATE "${r.table}" SET contractor_id = NULL WHERE contractor_id = ?`).run(d.id);
        db.prepare("DELETE FROM contractors WHERE id = ?").run(d.id);
        console.log(`[merge] "${name}" was no contractor – removed, its rows keep no contractor.`);
        changed++;
      }
      changed += fold("bond_types", "type_id", BOND_TYPES, "bond type");
    })();
  } catch (e) {
    console.error("[merge] folding duplicates failed:", e);
    return;
  }
  if (changed) requestBackup("merge-duplicates");
}
