# Commercial Dashboard

A web application that replaces the monthly Excel commercial report for a construction programme.
It runs in a browser on a laptop or a phone, has login with roles, and every register (list of
records) supports add / edit / delete, filter, sort, search, export to Excel, import from Excel and a
full change history. At month end an Admin **locks** the reporting period and the app stores a
snapshot so later reports can compare *This Period* vs *Previous Period*.

All money is in **SAR** with thousands separators and 2 decimals. Dates show as **DD-MMM-YY**.

---

## 1. Running it on your laptop (first time)

You only need to do steps 1–3 once.

1. **Install Node.js** (the engine that runs the app). Download the *LTS* version from
   <https://nodejs.org> and install it with the default options. Version 20.9 or newer is required; 22 is recommended.
2. **Get the code** onto your laptop (download the ZIP from GitHub and unzip it, or `git clone` it).
3. **Open a terminal in the project folder**
   - Windows: open the folder in File Explorer, click the address bar, type `cmd` and press Enter.
   - Mac: right-click the folder in Finder → *New Terminal at Folder*.

   Then type:

   ```bash
   npm install
   ```

   This downloads the building blocks the app needs (takes a minute or two, only the first time).

4. **Start the app**

   ```bash
   npm run dev
   ```

   When you see `Ready`, open <http://localhost:3000> in your browser.

5. **Log in** with the first admin account:

   | Email | Password |
   | --- | --- |
   | `admin@commercial.local` | `Admin@123` |

   Change this password straight away: *Settings → Users → edit your user → Password*.

To stop the app press `Ctrl + C` in the terminal. To start it again, repeat step 4.

### Using it from your phone

While the app is running on your laptop, both devices must be on the same Wi-Fi. The terminal
prints a *Network* address such as `http://192.168.1.20:3000` – open that on your phone.

### Running it for real (faster, for the team)

```bash
npm run build
npm start
```

This runs the optimised version. Put it on a small always-on machine or a cloud server so the team
and directors can reach it. Set a proper `SESSION_SECRET` first (see below).

---

## 2. Where your data lives

Everything is stored in **one file**: `data/commercial.db` (an SQLite database).

- **Backup** = copy that file somewhere safe (e.g. OneDrive) while the app is stopped.
- **Restore** = put the copy back in the `data` folder.
- Deleting the file gives you a clean, empty app with the default admin user again.

This file is deliberately *not* committed to Git.

---

## 3. Settings you can change (optional)

Copy `.env.example` to `.env` and edit:

| Setting | What it does |
| --- | --- |
| `SESSION_SECRET` | Random text used to sign login cookies. **Change it** before sharing the app. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | First admin user (only used on the very first start). |
| `DB_PATH` | Where the database file is kept. |

---

## 4. Roles

| Role | Can do |
| --- | --- |
| **Admin** (you) | Everything: settings & dropdown lists, users, lock / unlock periods, all modules. |
| **Editor** (your team) | Add / edit / delete / import in the module registers, change the top-bar selection. Settings are view-only. |
| **Viewer** (directors) | Read everything and export to Excel. Cannot change anything. |

Add people under *Settings → Users*.

---

## 5. Month-end routine

1. Make sure every module is up to date for the month.
2. *Settings → Reporting Periods → Lock* on the current period. The app stores a snapshot of every module register.
3. Add the next period (*Add Reporting Period* – the label “Monthly Report No X – Mon'YY” fills in automatically from the cut-off date).
4. Select the new period in the top bar.

If you find a mistake after locking, an Admin can *Unlock*, fix it, and *Lock* again (the snapshot is re-taken).

---

## 6. Excel import / export

Every register has **Export** (all rows, formatted) and **Import**:

1. Download the blank template (link inside the Import window) or an Export of the register.
2. Fill one record per row. Leave *ID* blank for new records; keep the *ID* to update an existing record.
3. Dropdown / lookup columns must match the values on the *Lists* sheet. Dates can be `09-Sep-26` or real Excel dates.
4. Choose the file and press *Import*. The app tells you what was added, updated, and any rows it could not read.

---

## 7. Modules

| # | Module | Status |
| --- | --- | --- |
| 1 | Project Setup & Report Control | **built** – project particulars, report control & sign-off, report checklist, distribution list |
| 2 | Cost Report Level 1 & 2 | **built** – Level 2 by package/contractor, Level 1 by asset, formulas, check line, chart, Excel export |
| 3 | Change Management Tracker | **built** – stages EW→RFC→PVO→VO→EI→DVO→Funding, status matrix, days open, feeds cost report H/J/K |
| 4 | Claims & Disputes | **built** – notice / detailed claim compliance (auto), 4-party assessment, summary cards, feeds cost report M |
| 5 | Early Warnings & Risks / Opportunities | **built** – EW register feeds cost report L; risk register with expected value, heat map, totals |
| 6 | Provisional Sums | **built** – budget vs contract value, (saving)/extra auto, totals row and cards |
| 7 | Bonds & Insurance | **built** – requirement vs provided, variance, days to expiry with amber/red rows, expiring-soon alert |
| 8 | Invoice & Payment Tracking | **built** – contract summary with auto VOs/claims/revised value, IPC log with due dates & days late, chart, feeds cost report P |
| 9 | Cash Flow | placeholder |
| 10 | Budget Transfers | placeholder |
| 11 | Executive Summary & Minutes of Meeting | placeholder |
| 12 | Monthly Report Export (PDF / Excel) | placeholder |

Built so far: login and roles, left menu and top bar (Programme / Asset / Reporting Period), Settings
with all dropdown lists, Users, Reporting Periods with lock / snapshot, change history, and the shared
register engine (add / edit / delete / filter / sort / search / Excel export & import / history) that every
module will reuse.

---

## 8. For developers

- Next.js 16 (App Router, TypeScript, Tailwind v4), SQLite via `better-sqlite3`, `exceljs` for Excel, `jose` sessions, `bcryptjs` passwords.
- A register is declared once as a `RegisterDef` in `src/lib/registers/defs/*.ts`; tables are created / extended automatically on start-up.
- `src/lib/registers/engine.ts` – generic validation, CRUD, audit trail. `src/lib/excel.ts` – export / import. `src/lib/snapshots.ts` – period lock.
- `src/components/register/RegisterPage.tsx` – the generic screen used by every register.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` must all pass before committing.
