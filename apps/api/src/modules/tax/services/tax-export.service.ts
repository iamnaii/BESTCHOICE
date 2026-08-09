import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { TaxFormCode } from '../tax.service';
import { TaxPreviewService } from './tax-preview.service';

/**
 * TaxExportService — XLSX export of tax-form data (RD-format columns). Consumes
 * TaxPreviewService preview outputs only. Decomposed VERBATIM from the original
 * TaxService facade (behavior-preserving).
 */
@Injectable()
export class TaxExportService {
  constructor(private preview: TaxPreviewService) {}

  /**
   * Export tax form data as a 1-sheet XLSX (RD-format columns).
   *
   * Wraps the matching `preview*` query and emits an exceljs workbook as a
   * Buffer suitable for HTTP streaming. Returns RD-style columns:
   *   - PP30: sales / purchases sheets
   *   - PND1: employee + tax id + gross + WHT
   *   - PND3 / PND53: vendor + tax id + income type + gross + WHT% + WHT
   */
  async exportTaxFormXlsx(
    form: TaxFormCode,
    companyId: string,
    year: number,
    month: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BESTCHOICE';
    workbook.created = new Date();

    const periodLabel = `${year}-${String(month).padStart(2, '0')}`;

    if (form === 'PP30') {
      const data = await this.preview.previewPP30(companyId, year, month);
      const sheet = workbook.addWorksheet(`PP30-${periodLabel}`);
      sheet.columns = [
        { header: 'หมวด', key: 'category', width: 16 },
        { header: 'รายการ', key: 'description', width: 40 },
        { header: 'ผู้ขาย / ลูกค้า', key: 'party', width: 30 },
        { header: 'เลขที่กำกับภาษี', key: 'taxInvoiceNo', width: 18 },
        { header: 'วันที่', key: 'date', width: 12 },
        { header: 'มูลค่า (บาท)', key: 'amount', width: 14 },
        { header: 'ภาษีมูลค่าเพิ่ม (บาท)', key: 'vat', width: 16 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const s of data.lineItems.sales) {
        sheet.addRow({
          category: 'ขาย',
          description: s.description,
          party: s.customerName,
          taxInvoiceNo: s.contractNumber,
          date: s.date,
          amount: Number(s.amount ?? 0),
          vat: Number(s.vatAmount ?? 0),
        });
      }
      for (const p of data.lineItems.purchases) {
        sheet.addRow({
          category: 'ซื้อ',
          description: p.description,
          party: p.vendorName ?? '',
          taxInvoiceNo: p.taxInvoiceNo ?? '',
          date: p.date,
          amount: Number(p.amount ?? 0),
          vat: Number(p.vatAmount ?? 0),
        });
      }
      const summary = sheet.addRow({});
      summary.getCell('description').value = 'ภาษีขาย (Output VAT)';
      summary.getCell('vat').value = Number(data.totalVatOutput);
      summary.font = { bold: true };
      const summary2 = sheet.addRow({});
      summary2.getCell('description').value = 'ภาษีซื้อ (Input VAT)';
      summary2.getCell('vat').value = Number(data.totalVatInput);
      summary2.font = { bold: true };
      const summary3 = sheet.addRow({});
      summary3.getCell('description').value = 'ภาษีที่ต้องชำระ (Net VAT)';
      summary3.getCell('vat').value = Number(data.netVat);
      summary3.font = { bold: true };
    } else if (form === 'PND1') {
      const data = await this.preview.previewPND1(companyId, year, month);
      const sheet = workbook.addWorksheet(`PND1-${periodLabel}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อพนักงาน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'จำนวนเงินได้ (บาท)', key: 'gross', width: 18 },
        { header: 'ภาษีหัก ณ ที่จ่าย (บาท)', key: 'wht', width: 20 },
        { header: 'วันที่จ่าย', key: 'payDate', width: 12 },
        { header: 'เลขที่เอกสาร', key: 'doc', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.employeeName,
          taxId: it.employeeTaxId ?? '',
          gross: Number(it.gross),
          wht: Number(it.whtAmount),
          payDate: it.payDate,
          doc: it.payrollDocNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossIncome);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
    } else if (form === 'SSO110') {
      // สปส.1-10 — payroll round 2 (2026-08-06). Company-wide (one juristic person).
      const data = await this.preview.previewSso110(year, month);
      const sheet = workbook.addWorksheet(`SSO110-${periodLabel}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อผู้ประกันตน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวประชาชน', key: 'taxId', width: 22 },
        { header: 'ค่าจ้าง (บาท)', key: 'wage', width: 14 },
        { header: 'เงินสมทบผู้ประกันตน (บาท)', key: 'ssoEmployee', width: 22 },
        { header: 'เงินสมทบนายจ้าง (บาท)', key: 'ssoEmployer', width: 20 },
        { header: 'ฝั่ง', key: 'scope', width: 10 },
        { header: 'เลขที่เอกสาร', key: 'doc', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.employeeName,
          taxId: it.employeeTaxId ?? '',
          wage: Number(it.wage),
          ssoEmployee: Number(it.ssoEmployee),
          ssoEmployer: Number(it.ssoEmployer),
          scope: it.scope,
          doc: it.payrollDocNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('ssoEmployee').value = Number(data.employeeTotal);
      total.getCell('ssoEmployer').value = Number(data.employerTotal);
      total.font = { bold: true };
      const grand = sheet.addRow({});
      grand.getCell('name').value = 'รวมนำส่งทั้งสิ้น (ลูกจ้าง + นายจ้าง)';
      grand.getCell('ssoEmployer').value = Number(data.grandTotal);
      grand.font = { bold: true };
    } else if (form === 'PND1A') {
      // ภ.ง.ด.1ก — annual summary per employee (month param ignored).
      const data = await this.preview.previewPnd1Annual(year);
      const sheet = workbook.addWorksheet(`PND1A-${year}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อพนักงาน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'จำนวนเดือนที่จ่าย', key: 'months', width: 14 },
        { header: 'เงินได้ทั้งปี (บาท)', key: 'gross', width: 18 },
        { header: 'ภาษีหัก ณ ที่จ่ายทั้งปี (บาท)', key: 'wht', width: 22 },
        { header: 'เงินสมทบ ปกส. ทั้งปี (บาท)', key: 'sso', width: 22 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.employeeName,
          taxId: it.employeeTaxId ?? '',
          months: it.monthsPaid,
          gross: Number(it.grossTotal),
          wht: Number(it.whtTotal),
          sso: Number(it.ssoTotal),
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossTotal);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
      const wage = sheet.addRow({});
      wage.getCell('name').value = 'ค่าจ้างรวมทั้งปี (อ้างอิงยื่น กท.20ก)';
      wage.getCell('gross').value = Number(data.annualWageTotal);
      wage.font = { bold: true, italic: true };
    } else {
      // PND3 / PND53 — vendor WHT
      const data =
        form === 'PND3'
          ? await this.preview.previewPND3(companyId, year, month)
          : await this.preview.previewPND53(companyId, year, month);
      const sheet = workbook.addWorksheet(`${form}-${periodLabel}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อผู้รับเงิน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'ประเภทเงินได้', key: 'incomeType', width: 20 },
        { header: 'จำนวนเงิน (บาท)', key: 'gross', width: 16 },
        { header: 'อัตรา %', key: 'whtPercent', width: 10 },
        { header: 'ภาษีหัก ณ ที่จ่าย (บาท)', key: 'wht', width: 20 },
        { header: 'วันที่จ่าย', key: 'paidDate', width: 12 },
        { header: 'เลขที่เอกสาร', key: 'doc', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.vendorName,
          taxId: it.vendorTaxId ?? '',
          incomeType: it.incomeType ?? '',
          gross: Number(it.gross),
          whtPercent: Number(it.whtPercent),
          wht: Number(it.whtAmount),
          paidDate: it.paidDate,
          doc: it.expenseDocNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossIncome);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }
}
