import ExcelJS from 'exceljs';

type LetterRow = {
  id: string;
  letterNumber: string;
  letterType: string;
  status: string;
  triggeredAt: string | null;
  pdfGeneratedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  dispatchedBy?: { name: string } | null;
  contract: {
    contractNumber: string;
    customer: { name: string };
    branch: { name: string };
  };
};

const LETTER_TYPE_TH: Record<string, string> = {
  RETURN_DEVICE_45D: 'เก็บอุปกรณ์ 45 วัน',
  CONTRACT_TERMINATION_60D: 'บอกเลิกสัญญา 60 วัน',
};

const STATUS_TH: Record<string, string> = {
  PENDING_DISPATCH: 'รอพิมพ์',
  PDF_GENERATED: 'พิมพ์แล้ว',
  DISPATCHED: 'ส่งแล้ว',
  DELIVERED: 'ลูกค้ารับแล้ว',
  UNDELIVERABLE: 'ตีกลับ',
  CANCELLED: 'ยกเลิก',
};

const formatBkkDate = (iso: string | null): string => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('th-TH-u-ca-gregory', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
};

export async function lettersToExcel(letters: LetterRow[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Letters');

  sheet.columns = [
    { header: 'เลขจดหมาย', key: 'letterNumber', width: 18 },
    { header: 'เลขสัญญา', key: 'contractNumber', width: 16 },
    { header: 'ชื่อลูกค้า', key: 'customerName', width: 24 },
    { header: 'สาขา', key: 'branch', width: 14 },
    { header: 'ประเภท', key: 'letterType', width: 22 },
    { header: 'สถานะ', key: 'status', width: 14 },
    { header: 'สร้างเมื่อ', key: 'triggeredAt', width: 14 },
    { header: 'พิมพ์เมื่อ', key: 'pdfGeneratedAt', width: 14 },
    { header: 'ส่งเมื่อ', key: 'dispatchedAt', width: 14 },
    { header: 'Tracking No.', key: 'trackingNumber', width: 18 },
    { header: 'ลูกค้ารับเมื่อ', key: 'deliveredAt', width: 14 },
    { header: 'เหตุผลตีกลับ/ยกเลิก', key: 'cancelReason', width: 24 },
    { header: 'ผู้ส่ง', key: 'dispatchedBy', width: 16 },
  ];

  for (const l of letters) {
    sheet.addRow({
      letterNumber: l.letterNumber,
      contractNumber: l.contract.contractNumber,
      customerName: l.contract.customer.name,
      branch: l.contract.branch.name,
      letterType: LETTER_TYPE_TH[l.letterType] ?? l.letterType,
      status: STATUS_TH[l.status] ?? l.status,
      triggeredAt: formatBkkDate(l.triggeredAt),
      pdfGeneratedAt: formatBkkDate(l.pdfGeneratedAt),
      dispatchedAt: formatBkkDate(l.dispatchedAt),
      trackingNumber: l.trackingNumber ?? '',
      deliveredAt: formatBkkDate(l.deliveredAt),
      cancelReason: l.cancelReason ?? '',
      dispatchedBy: l.dispatchedBy?.name ?? '',
    });
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
