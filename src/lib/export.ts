// CSV / Excel export helpers. Excel support (exceljs) is loaded on demand.

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  numFmt?: string; // Excel number format, e.g. '#,##0.00'
  width?: number;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of text cells)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[], preamble: string[] = []): string {
  const lines = preamble.map((p) => csvCell(p));
  if (preamble.length) lines.push('');
  lines.push(columns.map((c) => csvCell(c.header)).join(','));
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(','));
  return '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8 (₹, €)
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, rows: T[], columns: ExportColumn<T>[], preamble: string[] = []) {
  download(new Blob([toCsv(rows, columns, preamble)], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadXlsx<T>(
  filename: string,
  sheetName: string,
  rows: T[],
  columns: ExportColumn<T>[],
  preamble: string[] = [],
) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ikris Pharma Network — Sales Tracker';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  for (const p of preamble) ws.addRow([p]).font = { italic: true, color: { argb: 'FF68758A' } };
  if (preamble.length) ws.addRow([]);

  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF226192' } };
  });
  const headerRowNumber = header.number;

  for (const r of rows) {
    ws.addRow(
      columns.map((c) => {
        const v = c.value(r);
        return v === null || v === undefined ? null : v;
      }),
    );
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.min(40, Math.max(12, c.header.length + 2));
    if (c.numFmt) col.numFmt = c.numFmt;
  });
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  ws.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  download(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
