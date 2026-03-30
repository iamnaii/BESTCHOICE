import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface DashboardExportData {
  kpis?: {
    contracts: { total: number; active: number; overdue: number; default: number; completed: number };
    products: { total: number; inStock: number };
    financial: { totalReceivable: number; totalLateFees: number; todayPayments: number; todayPaymentCount: number };
    overdueRate: number;
  };
  revenue?: { totalPayments: number; interestIncome: number; lateFeeIncome: number; paymentCount: number };
  aging?: {
    buckets: { range: string; label: string; count: number; contractCount: number; amount: number; lateFeeTotal: number }[];
    total: { count: number; contractCount: number; amount: number; lateFeeTotal: number };
  };
  staffPerf?: {
    salesMetrics: { name: string; branch: string; totalContracts: number; totalSales: number; collectionAmount: number; collectionRate: number; overdueCount: number; overdueRate: number }[];
  };
  branches?: { name: string; contracts: number; monthlyRevenue: number; collectionRate: number; overdueContracts: number; overdueRate: number; stockTurnover: number }[];
  exportDate: string;
  userName: string;
}

function dateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportDashboardExcel(data: DashboardExportData): Promise<void> {
  const wb = XLSX.utils.book_new();

  // Sheet 1: KPIs
  if (data.kpis) {
    const kpiRows = [
      ['ข้อมูล', 'จำนวน'],
      ['สัญญาทั้งหมด', data.kpis.contracts.total],
      ['สัญญา Active', data.kpis.contracts.active],
      ['ค้างชำระ', data.kpis.contracts.overdue],
      ['ผิดนัด', data.kpis.contracts.default],
      ['ปิดสัญญาแล้ว', data.kpis.contracts.completed],
      ['สินค้าทั้งหมด', data.kpis.products.total],
      ['สินค้าในสต็อก', data.kpis.products.inStock],
      ['ลูกหนี้คงค้าง (฿)', data.kpis.financial.totalReceivable],
      ['ค่าปรับรวม (฿)', data.kpis.financial.totalLateFees],
      ['ชำระวันนี้ (฿)', data.kpis.financial.todayPayments],
      ['อัตราค้างชำระ (%)', data.kpis.overdueRate],
    ];
    const ws = XLSX.utils.aoa_to_sheet(kpiRows);
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'สรุปภาพรวม');
  }

  // Sheet 2: Revenue
  if (data.revenue) {
    const revRows = [
      ['รายการ', 'จำนวน (฿)'],
      ['ยอดชำระรวม', data.revenue.totalPayments],
      ['ดอกเบี้ยรับ', data.revenue.interestIncome],
      ['ค่าปรับ', data.revenue.lateFeeIncome],
      ['จำนวนรายการ', data.revenue.paymentCount],
    ];
    const ws = XLSX.utils.aoa_to_sheet(revRows);
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'รายได้เดือนนี้');
  }

  // Sheet 3: Aging
  if (data.aging) {
    const agingRows = [
      ['ช่วงวัน', 'จำนวนงวด', 'จำนวนสัญญา', 'ยอดค้าง (฿)', 'ค่าปรับ (฿)'],
      ...data.aging.buckets.map((b) => [b.label || b.range, b.count, b.contractCount, b.amount, b.lateFeeTotal]),
      ['รวม', data.aging.total.count, data.aging.total.contractCount, data.aging.total.amount, data.aging.total.lateFeeTotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(agingRows);
    ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'อายุหนี้ค้างชำระ');
  }

  // Sheet 4: Staff
  if (data.staffPerf?.salesMetrics.length) {
    const staffRows = [
      ['พนักงาน', 'สาขา', 'สัญญา', 'ยอดขาย (฿)', 'เก็บเงินได้ (฿)', 'อัตราเก็บ%', 'ค้างชำระ', 'อัตราค้าง%'],
      ...data.staffPerf.salesMetrics.map((s) => [
        s.name, s.branch, s.totalContracts, s.totalSales, s.collectionAmount, s.collectionRate, s.overdueCount, s.overdueRate,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(staffRows);
    ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'กำกับพนักงาน');
  }

  // Sheet 5: Branches
  if (data.branches?.length) {
    const branchRows = [
      ['สาขา', 'สัญญา', 'รายได้/เดือน (฿)', 'อัตราเก็บ%', 'ค้างชำระ', 'อัตราค้าง%', 'ขายได้/เดือน'],
      ...data.branches.map((b) => [
        b.name, b.contracts, b.monthlyRevenue, b.collectionRate, b.overdueContracts, b.overdueRate, b.stockTurnover,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(branchRows);
    ws['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'เปรียบเทียบสาขา');
  }

  XLSX.writeFile(wb, `BESTCHOICE-Dashboard-${dateStr()}.xlsx`);
}

export async function exportDashboardPdf(data: DashboardExportData): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Try to load Thai font
  try {
    const response = await fetch('/fonts/THSarabunPSK-Regular.ttf');
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binary);
    doc.addFileToVFS('THSarabunPSK-Regular.ttf', base64);
    doc.addFont('THSarabunPSK-Regular.ttf', 'THSarabunPSK', 'normal');
    doc.setFont('THSarabunPSK');
  } catch {
    // Fallback to Helvetica if Thai font not available
  }

  const pageWidth = doc.internal.pageSize.width;
  let y = 15;

  // Title
  doc.setFontSize(18);
  doc.text('BESTCHOICE Dashboard Report', pageWidth / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(10);
  doc.text(`${data.exportDate} | ${data.userName}`, pageWidth / 2, y, { align: 'center' });
  y += 10;

  // KPIs
  if (data.kpis) {
    doc.setFontSize(13);
    doc.text('KPI Summary', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Metric', 'Value']],
      body: [
        ['Total Contracts', String(data.kpis.contracts.total)],
        ['Active', String(data.kpis.contracts.active)],
        ['Overdue', String(data.kpis.contracts.overdue)],
        ['Default', String(data.kpis.contracts.default)],
        ['Total Receivable', `${data.kpis.financial.totalReceivable.toLocaleString()} B`],
        ['Today Payments', `${data.kpis.financial.todayPayments.toLocaleString()} B`],
        ['Overdue Rate', `${data.kpis.overdueRate}%`],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [59, 130, 246] },
      margin: { left: 14, right: pageWidth / 2 + 5 },
    });

    // Revenue table on the right
    if (data.revenue) {
      autoTable(doc, {
        startY: y,
        head: [['Revenue', 'Amount (B)']],
        body: [
          ['Total Payments', data.revenue.totalPayments.toLocaleString()],
          ['Interest Income', data.revenue.interestIncome.toLocaleString()],
          ['Late Fee Income', data.revenue.lateFeeIncome.toLocaleString()],
          ['Payment Count', String(data.revenue.paymentCount)],
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [34, 197, 94] },
        margin: { left: pageWidth / 2 + 5, right: 14 },
      });
    }
  }

  // Aging on new section
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable?.finalY + 10 || y + 50;

  if (data.aging) {
    doc.setFontSize(13);
    doc.text('Aging Summary', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Range', 'Payments', 'Contracts', 'Outstanding (B)', 'Late Fee (B)']],
      body: [
        ...data.aging.buckets.map((b) => [
          b.label || b.range,
          String(b.count),
          String(b.contractCount),
          b.amount.toLocaleString(),
          b.lateFeeTotal.toLocaleString(),
        ]),
        ['Total', String(data.aging.total.count), String(data.aging.total.contractCount), data.aging.total.amount.toLocaleString(), data.aging.total.lateFeeTotal.toLocaleString()],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [239, 68, 68] },
      margin: { left: 14 },
    });
  }

  // Branches
  if (data.branches?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable?.finalY + 10 || y + 40;
    if (y > doc.internal.pageSize.height - 40) {
      doc.addPage();
      y = 15;
    }
    doc.setFontSize(13);
    doc.text('Branch Comparison', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Branch', 'Contracts', 'Revenue (B)', 'Collection%', 'Overdue', 'Overdue%']],
      body: data.branches.map((b) => [
        b.name,
        String(b.contracts),
        b.monthlyRevenue.toLocaleString(),
        `${b.collectionRate}%`,
        String(b.overdueContracts),
        `${b.overdueRate}%`,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241] },
      margin: { left: 14 },
    });
  }

  doc.save(`BESTCHOICE-Dashboard-${dateStr()}.pdf`);
}
