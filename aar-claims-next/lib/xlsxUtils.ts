import * as XLSX from "xlsx";

// Trims a worksheet's declared range down to its actual populated cells.
//
// Some export tools leave a sheet's declared "used range" far larger
// than its real content — e.g. formatting once applied to a whole
// row/column makes Excel report the range as extending to row
// 1,048,576, even if only a few hundred rows have real data. SheetJS's
// sheet_to_json walks the ENTIRE declared range cell-by-cell, which can
// take minutes or effectively freeze a browser tab (or time out a
// serverless function) even for a genuinely small file.
//
// Fix: SheetJS stores cells sparsely as object keys (e.g. "A1", "B2")
// rather than a dense array regardless of the declared range, so
// scanning Object.keys(ws) costs time proportional to REAL data only —
// never the bloated declared range. Call this before sheet_to_json.
//
// BUG FIX: this used to call Object.keys(ws) unconditionally. If the
// workbook has zero sheets, or the requested sheet name isn't actually
// present in wb.Sheets (empty/corrupted/password-protected file), `ws`
// is `undefined`, and Object.keys(undefined) throws
// "Cannot convert undefined or null to object" — which is exactly the
// error surfacing on the upload page. Guard against that here so the
// caller gets a clear signal instead of a cryptic native TypeError.
export function trimSheetRange(ws: XLSX.WorkSheet | undefined): void {
  if (!ws) {
    throw new Error("That file doesn't contain a readable sheet — it may be empty, corrupted, or password-protected.");
  }
  let maxRow = 0;
  let maxCol = 0;
  let found = false;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = (ws as Record<string, XLSX.CellObject>)[key];
    if (cell && cell.v !== undefined && cell.v !== "") {
      const { r, c } = XLSX.utils.decode_cell(key);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
      found = true;
    }
  }
  if (found) {
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  }
}

// BUG FIX: callers used to always read wb.Sheets[wb.SheetNames[0]] — the
// FIRST tab, unconditionally. That breaks on very common real-world
// files: a cover/instructions tab before the data tab, or a
// chartsheet/dialogsheet (which appear in wb.SheetNames but have no
// entry in wb.Sheets at all, since they aren't regular worksheets).
// None of that means the file is empty, corrupted, or
// password-protected — it just means the data isn't on tab 1. Walk the
// sheets in order and use the first one that's an actual worksheet with
// real populated cells.
export function pickDataSheet(wb: XLSX.WorkBook): { sheetName: string; ws: XLSX.WorkSheet } {
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("This workbook has no sheets.");
  }
  for (const name of wb.SheetNames) {
    const candidate = wb.Sheets[name];
    if (!candidate) continue; // not a real worksheet (e.g. a chartsheet/dialogsheet)
    const hasData = Object.keys(candidate).some(
      (k) => k[0] !== "!" && (candidate as Record<string, XLSX.CellObject>)[k]?.v !== undefined && (candidate as Record<string, XLSX.CellObject>)[k]?.v !== ""
    );
    if (hasData) return { sheetName: name, ws: candidate };
  }
  throw new Error(
    "None of the sheets in this workbook contain any data. If your claims data is on a specific tab, check that it isn't empty or hidden behind a cover sheet."
  );
}
