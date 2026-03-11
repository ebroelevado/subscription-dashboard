/**
 * Secure CSV Utilities
 *
 * Provides functions to convert JSON data to CSV strings safely in Node.js
 * without using shell commands or external processes.
 */

export interface CsvColumn {
  header: string;
  key: string;
}

/**
 * Converts an array of objects to a CSV string.
 * Escapes values according to RFC 4180.
 */
export function jsonToCsv(data: any[], columns?: CsvColumn[]): string {
  if (!data || data.length === 0) return "";

  const keys = columns ? columns.map(c => c.key) : Object.keys(data[0]);
  const headers = columns ? columns.map(c => c.header) : keys;

  const escape = (val: any) => {
    if (val === null || val === undefined) return "";
    let str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const headerRow = headers.map(escape).join(",");
  const rows = data.map(item =>
    keys.map(key => escape(item[key])).join(",")
  );

  return [headerRow, ...rows].join("\n");
}
