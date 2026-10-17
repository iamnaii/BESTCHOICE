const contractColumns = [
  ['contractNumber', 'เลขที่สัญญา'], ['status', 'สถานะ'], ['customerName', 'ลูกค้า'],
  ['customerPhone', 'เบอร์โทร'], ['productName', 'สินค้า'], ['imei', 'IMEI'],
  ['branch', 'สาขา'], ['salesperson', 'พนักงานขาย'], ['sellingPrice', 'ราคาขาย'],
  ['downPayment', 'เงินดาวน์'], ['interestRate', 'อัตราดอกเบี้ย'], ['totalMonths', 'จำนวนงวด'],
  ['monthlyPayment', 'ค่างวด'], ['financedAmount', 'เงินต้น'], ['interestTotal', 'ดอกเบี้ยรวม'],
  ['paidInstallments', 'งวดที่ชำระแล้ว'], ['totalPaid', 'ยอดรับชำระ'], ['totalLateFees', 'ค่าปรับรวม'], ['createdAt', 'วันที่สร้าง'],
] as const;

function cell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The report endpoint returns records; downloads must serialize real CSV. */
export function contractsCsv(rows: Record<string, unknown>[]) {
  return '\uFEFF' + [contractColumns.map(([, label]) => cell(label)).join(','),
    ...rows.map(row => contractColumns.map(([key]) => cell(row[key])).join(',')),
  ].join('\r\n');
}
