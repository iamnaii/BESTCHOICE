import type { AssetRegisterResponse, AssetRegisterRow } from '../types';

const HEADERS = [
  'รหัสสินทรัพย์', 'ชื่อ', 'หมวด', 'วันที่ซื้อ', 'ราคาทุน',
  'ค่าเสื่อมสะสม', 'NBV', 'ค่าเสื่อม/เดือน', 'เดือนคงเหลือ',
  'ผู้ดูแล', 'ที่ตั้ง', 'สาขา', 'สถานะ',
];

const CATEGORY_LABEL: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

function rowsToValues(row: AssetRegisterRow): (string | number)[] {
  return [
    row.assetCode,
    row.name,
    CATEGORY_LABEL[row.category] ?? row.category,
    row.purchaseDate,
    row.purchaseCost,
    row.accumulatedDeprAt,
    row.netBookValueAt,
    row.monthlyDepr,
    row.remainingMonths,
    row.custodian ?? '',
    row.location ?? '',
    row.branch?.name ?? '',
    row.status,
  ];
}

export function exportRegisterCsv(data: AssetRegisterResponse): void {
  const lines = [HEADERS.join(',')];
  for (const row of data.data) {
    const values = rowsToValues(row).map((v) => {
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(values.join(','));
  }
  // BOM for Excel UTF-8 compatibility (Thai chars)
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asset-register-${data.asOfDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportRegisterXlsx(data: AssetRegisterResponse): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Asset Register');
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (const row of data.data) {
    sheet.addRow(rowsToValues(row));
  }
  // Column widths
  sheet.columns = [
    { width: 14 }, { width: 24 }, { width: 22 }, { width: 12 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asset-register-${data.asOfDate}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
