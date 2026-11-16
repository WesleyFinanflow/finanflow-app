// CSV is intended for spreadsheet viewing; neutralize formula-like text fields.
export function csvCell(value) {
  const text = String(value ?? "");
  const protectedText = /^[\s\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/u.test(text) ? "\t" + text : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
export const csvRows = (rows, separator = ";") => rows.map(row => row.map(csvCell).join(separator)).join("\r\n");
