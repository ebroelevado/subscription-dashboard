/**
 * Secure CSV Utilities
 *
 * Provides functions to convert JSON data to CSV strings safely in the browser
 * without using shell commands or external processes.
 *
 * Uses semicolon (;) as delimiter for European locale compatibility (Excel, LibreOffice).
 * Adds UTF-8 BOM so Excel auto-detects the encoding correctly.
 */

export interface CsvColumn {
  header: string;
  key: string;
}

const DELIMITER = ";";

/**
 * Escapes a cell value for CSV, with smart Excel formatting protection.
 *
 * Problem: Excel auto-interprets certain values:
 *   "+34676675655" → number 34676675655 (strips the +)
 *   "2026-03-11"   → date serial number (shows ######)
 *   "0012345"      → number 12345 (strips leading zeros)
 *
 * Solution: Use the ="'value'" formula trick for values that Excel would
 * misinterpret. Excel evaluates the formula and displays the raw text.
 */
function escapeCell(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val)
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");

  // Detect values that Excel would misinterpret and force text mode
  const needsTextMode =
    // Phone numbers: starts with + (e.g. "+34 654 02 56 45", "+34676675655")
    /^\+/.test(str) ||
    // ISO dates: YYYY-MM-DD with optional time (e.g. "2026-03-11", "2026-03-11T10:00:00")
    /^\d{4}-\d{2}-\d{2}/.test(str) ||
    // Slash dates: D/M/YYYY or DD/MM/YYYY (e.g. "5/4/2026", "25/02/2026")
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str) ||
    // Long numeric strings: 6+ digits that would lose precision or get scientific notation
    /^\d{6,}$/.test(str) ||
    // Leading zeros: "007", "0012345" — Excel strips them
    /^0\d+$/.test(str);

  if (needsTextMode) {
    // ="value" forces Excel to evaluate this as a formula that returns the literal text.
    // IMPORTANT: NO inner single quotes — those would appear visually in the cell.
    // Escape any embedded double-quotes by doubling them (RFC 4180 inside the formula string).
    const escaped = str.replace(/"/g, '""');
    return `="` + escaped + `"`;
  }

  // Standard quoting: wrap in double quotes, escape embedded quotes by doubling
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Converts an array of objects to a CSV string.
 * Returns a BOM-prefixed UTF-8 string that opens correctly in Excel/LibreOffice.
 */
export function jsonToCsv(data: any[], columns?: CsvColumn[]): string {
  if (!data || data.length === 0) return "";

  const keys = columns ? columns.map(c => c.key) : Object.keys(data[0]);
  const headers = columns ? columns.map(c => c.header) : keys;

  const headerRow = headers.map(escapeCell).join(DELIMITER);
  const rows = data.map(item =>
    keys.map(key => escapeCell(item[key])).join(DELIMITER)
  );

  // \uFEFF = UTF-8 BOM — tells Excel this is UTF-8 encoded so accented chars render correctly
  return "\uFEFF" + [headerRow, ...rows].join("\r\n");
}
