import { paperSpacingScript, PAPER_SPACING_CSS } from '@installment/shared';
import { TRANSACTION_PAGE_CSS, transactionDocumentCss } from '@installment/shared';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { thaiBahtText } from '../../../utils/thai-baht-text.util';


type DocWithItems = Prisma.OtherIncomeGetPayload<{
  include: {
    items: true;
    customer: { select: { id: true; name: true; phone: true } };
    createdBy: { select: { id: true; name: true; email: true } };
  };
}>;

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  // Pin to Asia/Bangkok so server TZ (Cloud Run UTC) doesn't shift the date
  // by 1 day for late-evening BKK timestamps, and render year in Buddhist
  // Era (พ.ศ.) — required for Thai ใบกำกับภาษี per Revenue Department.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = parseInt(get('year'), 10) + 543;
  return `${get('day')}/${get('month')}/${year}`;
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAddress(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const addr = JSON.parse(trimmed) as Record<string, string | undefined>;
    if (typeof addr !== 'object' || addr === null) return trimmed;
    if (addr.raw && !addr.province) return addr.raw;
    const parts: string[] = [];
    if (addr.houseNo) parts.push(`เลขที่ ${addr.houseNo}`);
    if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
    if (addr.village) parts.push(`หมู่บ้าน ${addr.village}`);
    if (addr.soi) parts.push(`ซอย ${addr.soi}`);
    if (addr.road) parts.push(`ถนน ${addr.road}`);
    if (addr.subdistrict) parts.push(`ตำบล${addr.subdistrict}`);
    if (addr.district) parts.push(`อำเภอ${addr.district}`);
    if (addr.province) parts.push(`จังหวัด${addr.province}`);
    if (addr.postalCode) parts.push(addr.postalCode);
    return parts.length > 0 ? parts.join(' ') : trimmed;
  } catch {
    return trimmed;
  }
}

/** Convert a number to its Thai-baht spelling. Handles negative + millions. */
// Thai-baht-in-words now lives in the shared thai-baht-text util (Wave 4 dedup).
function numberToThaiText(num: number): string {
  return thaiBahtText(num);
}

// BESTCHOICE wordmark — reused from receipts.service.ts (installment receipts).
const BESTCHOICE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="395 285 710 425" fill="none"><defs><linearGradient id="bc-oi" gradientUnits="userSpaceOnUse" x1="597.6" y1="434.1" x2="902.4" y2="434.1"><stop offset="0" stop-color="#39F0CF"/><stop offset="0.5" stop-color="#25BC93"/><stop offset="1" stop-color="#1DA579"/></linearGradient></defs><path fill="url(#bc-oi)" d="M 603.769531 297.347656 C 600.023438 298.191406 597.769531 301.1875 597.597656 305.820312 C 597.414062 310.808594 599.695312 314.0625 603.605469 315.121094 C 605.0625 315.515625 606.605469 315.484375 608.132812 315.453125 C 608.550781 315.445312 608.96875 315.4375 609.382812 315.4375 C 623.914062 315.445312 638.449219 315.445312 652.980469 315.445312 C 662.1875 315.445312 671.390625 315.445312 680.59375 315.445312 C 692.277344 315.449219 696.074219 321.558594 693.207031 335.660156 C 687.417969 364.132812 681.613281 392.601562 675.878906 421.089844 C 673.085938 434.941406 678.320312 443.273438 689.765625 443.289062 C 717.367188 443.324219 744.976562 443.292969 772.582031 443.335938 C 782.101562 443.351562 785.0625 447.972656 782.789062 459.183594 C 777.746094 484.074219 772.6875 508.957031 767.59375 533.832031 C 764.777344 547.605469 759.269531 552.824219 747.617188 552.828125 C 701.550781 552.84375 655.484375 552.839844 609.414062 552.847656 C 608.996094 552.847656 608.578125 552.84375 608.160156 552.835938 C 606.816406 552.820312 605.472656 552.800781 604.144531 552.976562 C 599.992188 553.523438 597.800781 556.847656 597.597656 561.664062 C 597.402344 566.289062 599.542969 569.574219 603.199219 570.730469 C 604.714844 571.210938 606.347656 571.191406 607.960938 571.171875 C 608.292969 571.164062 608.628906 571.160156 608.960938 571.160156 C 650.808594 571.183594 692.65625 571.175781 734.503906 571.179688 C 776.878906 571.183594 819.257812 571.214844 861.632812 571.164062 C 873.066406 571.152344 879.71875 564.628906 882.480469 551.023438 C 888.8125 519.808594 895.195312 488.605469 901.441406 457.363281 C 905.367188 437.703125 897.210938 424.992188 880.769531 424.957031 C 868.933594 424.933594 857.101562 424.9375 845.265625 424.941406 C 833.714844 424.945312 822.164062 424.949219 810.613281 424.925781 C 799.550781 424.90625 794.933594 417.503906 797.613281 404.195312 C 802.675781 379.085938 807.78125 353.988281 812.839844 328.878906 C 816.617188 310.132812 808.339844 297.125 792.601562 297.121094 C 731.234375 297.097656 669.867188 297.109375 608.503906 297.117188 C 607.859375 297.117188 607.214844 297.097656 606.566406 297.097656 C 605.625 297.097656 604.683594 297.140625 603.769531 297.347656"/><path fill="#4D4D4D" d="M 434.851562 645.261719 L 432.128906 658.890625 L 446.460938 658.890625 C 450.027344 658.890625 452.738281 658.199219 454.589844 656.820312 C 456.4375 655.441406 457.363281 653.441406 457.363281 650.816406 C 457.363281 647.117188 454.570312 645.261719 448.984375 645.261719 Z M 452.214844 684.933594 C 454.234375 683.523438 455.246094 681.4375 455.246094 678.675781 C 455.246094 676.65625 454.503906 675.160156 453.023438 674.183594 C 451.542969 673.207031 449.523438 672.71875 446.964844 672.71875 L 429.300781 672.71875 L 426.476562 687.054688 L 443.835938 687.054688 C 447.402344 687.054688 450.199219 686.347656 452.214844 684.933594 M 472.65625 670.652344 C 474.304688 673.039062 475.128906 675.851562 475.128906 679.078125 C 475.128906 686.414062 472.136719 691.984375 466.148438 695.785156 C 460.15625 699.589844 452.351562 701.488281 442.726562 701.488281 L 403.863281 701.488281 L 417.996094 630.828125 L 453.730469 630.828125 C 461.667969 630.828125 467.746094 632.257812 471.949219 635.117188 C 476.15625 637.980469 478.257812 642.066406 478.257812 647.382812 C 478.257812 651.488281 477.148438 655.039062 474.929688 658.03125 C 472.707031 661.027344 469.613281 663.367188 465.640625 665.046875 C 468.667969 666.394531 471.007812 668.261719 472.65625 670.652344"/><path fill="#4D4D4D" d="M 512.175781 646.273438 L 509.855469 658.183594 L 541.25 658.183594 L 538.320312 673.125 L 506.828125 673.125 L 504.304688 686.042969 L 541.351562 686.042969 L 538.121094 701.488281 L 481.488281 701.488281 L 495.621094 630.828125 L 550.941406 630.828125 L 547.808594 646.273438 Z"/><path fill="#4D4D4D" d="M 559.015625 700.78125 C 553.765625 699.371094 549.492188 697.554688 546.195312 695.332031 L 554.070312 680.390625 C 557.632812 682.679688 561.4375 684.414062 565.472656 685.589844 C 569.511719 686.769531 573.550781 687.355469 577.589844 687.355469 C 581.425781 687.355469 584.402344 686.800781 586.523438 685.691406 C 588.640625 684.582031 589.703125 683.050781 589.703125 681.097656 C 589.703125 679.417969 588.742188 678.105469 586.824219 677.164062 C 584.90625 676.21875 581.929688 675.210938 577.890625 674.132812 C 573.3125 672.921875 569.511719 671.695312 566.484375 670.449219 C 563.457031 669.203125 560.847656 667.304688 558.660156 664.746094 C 556.472656 662.1875 555.378906 658.824219 555.378906 654.652344 C 555.378906 649.601562 556.757812 645.179688 559.519531 641.378906 C 562.277344 637.574219 566.214844 634.632812 571.328125 632.542969 C 576.445312 630.460938 582.433594 629.414062 589.296875 629.414062 C 594.34375 629.414062 599.054688 629.9375 603.429688 630.980469 C 607.804688 632.023438 611.574219 633.519531 614.738281 635.472656 L 607.46875 650.308594 C 604.707031 648.5625 601.664062 647.230469 598.332031 646.324219 C 595.003906 645.414062 591.585938 644.960938 588.085938 644.960938 C 584.117188 644.960938 581.003906 645.601562 578.75 646.878906 C 576.492188 648.15625 575.367188 649.804688 575.367188 651.824219 C 575.367188 653.574219 576.34375 654.921875 578.296875 655.863281 C 580.246094 656.804688 583.273438 657.816406 587.378906 658.890625 C 591.957031 660.035156 595.742188 661.210938 598.738281 662.425781 C 601.730469 663.636719 604.304688 665.484375 606.460938 667.976562 C 608.613281 670.464844 609.6875 673.730469 609.6875 677.765625 C 609.6875 682.75 608.292969 687.140625 605.5 690.941406 C 602.707031 694.742188 598.738281 697.6875 593.589844 699.773438 C 588.441406 701.859375 582.464844 702.902344 575.671875 702.902344 C 569.816406 702.902344 564.261719 702.195312 559.015625 700.78125"/><path fill="#4D4D4D" d="M 639.566406 646.675781 L 617.863281 646.675781 L 621.09375 630.828125 L 684.386719 630.828125 L 681.15625 646.675781 L 659.554688 646.675781 L 648.550781 701.488281 L 628.566406 701.488281 Z"/><path fill="#1DA579" d="M 717.195312 686.347656 C 711.878906 686.347656 707.671875 684.902344 704.574219 682.007812 C 701.480469 679.113281 699.933594 675.277344 699.933594 670.5 C 699.933594 665.855469 700.890625 661.667969 702.808594 657.933594 C 704.726562 654.195312 707.402344 651.269531 710.835938 649.148438 C 714.265625 647.03125 718.238281 645.96875 722.746094 645.96875 C 729.675781 645.96875 734.859375 648.730469 738.292969 654.246094 L 752.726562 642.738281 C 750.234375 638.5 746.46875 635.21875 741.421875 632.898438 C 736.375 630.578125 730.585938 629.414062 724.058594 629.414062 C 715.441406 629.414062 707.769531 631.230469 701.042969 634.867188 C 694.3125 638.5 689.082031 643.546875 685.347656 650.007812 C 681.609375 656.46875 679.742188 663.738281 679.742188 671.8125 C 679.742188 677.9375 681.191406 683.355469 684.085938 688.0625 C 686.976562 692.777344 691.117188 696.425781 696.5 699.015625 C 701.882812 701.605469 708.140625 702.902344 715.277344 702.902344 C 721.871094 702.902344 727.726562 701.875 732.839844 699.824219 C 737.953125 697.773438 742.429688 694.421875 746.265625 689.78125 L 734.457031 678.171875 C 729.675781 683.621094 723.921875 686.347656 717.195312 686.347656"/><path fill="#1DA579" d="M 807.234375 657.277344 L 780.082031 657.277344 L 785.332031 630.828125 L 765.34375 630.828125 L 751.210938 701.488281 L 771.199219 701.488281 L 776.648438 674.03125 L 803.804688 674.03125 L 798.351562 701.488281 L 818.339844 701.488281 L 832.472656 630.828125 L 812.484375 630.828125 Z"/><path fill="#1DA579" d="M 891.929688 674.082031 C 890.109375 677.816406 887.519531 680.796875 884.15625 683.015625 C 880.789062 685.238281 876.886719 686.347656 872.445312 686.347656 C 867.195312 686.347656 863.109375 684.917969 860.179688 682.058594 C 857.253906 679.199219 855.789062 675.378906 855.789062 670.601562 C 855.789062 666.09375 856.699219 661.96875 858.515625 658.234375 C 860.332031 654.5 862.921875 651.519531 866.289062 649.300781 C 869.652344 647.078125 873.554688 645.96875 877.996094 645.96875 C 883.246094 645.96875 887.335938 647.398438 890.261719 650.261719 C 893.191406 653.121094 894.652344 656.9375 894.652344 661.71875 C 894.652344 666.226562 893.746094 670.347656 891.929688 674.082031 M 898.339844 633.351562 C 893.054688 630.726562 886.847656 629.414062 879.714844 629.414062 C 871.167969 629.414062 863.546875 631.230469 856.851562 634.867188 C 850.152344 638.5 844.9375 643.546875 841.203125 650.007812 C 837.46875 656.46875 835.601562 663.734375 835.601562 671.8125 C 835.601562 677.867188 837.03125 683.253906 839.890625 687.964844 C 842.75 692.675781 846.820312 696.339844 852.105469 698.964844 C 857.386719 701.589844 863.597656 702.902344 870.730469 702.902344 C 879.273438 702.902344 886.898438 701.085938 893.59375 697.449219 C 900.289062 693.816406 905.503906 688.769531 909.238281 682.308594 C 912.976562 675.851562 914.84375 668.582031 914.84375 660.507812 C 914.84375 654.449219 913.410156 649.066406 910.550781 644.355469 C 907.691406 639.644531 903.621094 635.976562 898.339844 633.351562"/><path fill="#1DA579" d="M 917.972656 701.488281 L 937.957031 701.488281 L 952.089844 630.828125 L 932.101562 630.828125 Z"/><path fill="#1DA579" d="M 992.667969 686.347656 C 987.351562 686.347656 983.144531 684.902344 980.050781 682.007812 C 976.957031 679.113281 975.40625 675.277344 975.40625 670.5 C 975.40625 665.855469 976.367188 661.667969 978.285156 657.933594 C 980.203125 654.195312 982.878906 651.269531 986.308594 649.148438 C 989.742188 647.03125 993.710938 645.96875 998.222656 645.96875 C 1005.152344 645.96875 1010.335938 648.730469 1013.765625 654.246094 L 1028.203125 642.738281 C 1025.710938 638.5 1021.945312 635.21875 1016.894531 632.898438 C 1011.847656 630.578125 1006.058594 629.414062 999.535156 629.414062 C 990.917969 629.414062 983.246094 631.230469 976.519531 634.867188 C 969.789062 638.5 964.554688 643.546875 960.820312 650.007812 C 957.085938 656.46875 955.21875 663.738281 955.21875 671.8125 C 955.21875 677.9375 956.664062 683.355469 959.558594 688.0625 C 962.453125 692.777344 966.589844 696.425781 971.976562 699.015625 C 977.359375 701.605469 983.617188 702.902344 990.75 702.902344 C 997.347656 702.902344 1003.199219 701.875 1008.316406 699.824219 C 1013.429688 697.773438 1017.90625 694.421875 1021.742188 689.78125 L 1009.929688 678.171875 C 1005.152344 683.621094 999.398438 686.347656 992.667969 686.347656"/><path fill="#1DA579" d="M 1093.007812 646.273438 L 1096.136719 630.828125 L 1040.820312 630.828125 L 1026.6875 701.488281 L 1083.316406 701.488281 L 1086.546875 686.042969 L 1049.5 686.042969 L 1052.023438 673.125 L 1083.519531 673.125 L 1086.445312 658.183594 L 1055.050781 658.183594 L 1057.375 646.273438 Z"/></svg>`;

@Injectable()
export class OtherIncomeReceiptPdfService {
  private readonly logger = new Logger(OtherIncomeReceiptPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(id: string): Promise<Buffer> {
    const doc = await this.prisma.otherIncome.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    // Only POSTED/REVERSED documents have a recorded journal entry — issuing
    // an official ใบเสร็จรับเงิน/ใบกำกับภาษี for a DRAFT/READY/REJECTED doc
    // would print a tax document for a transaction the books don't recognize.
    if (doc.status !== 'POSTED' && doc.status !== 'REVERSED') {
      throw new BadRequestException('เอกสารยังไม่ได้บันทึกบัญชี ไม่สามารถออกใบเสร็จได้');
    }

    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE' },
    });

    // Look up bank/cash account name from CoA so we can show "ธ.กสิกรไทย / ออมทรัพย์ ..."
    const payAccount = await this.prisma.chartOfAccount.findUnique({
      where: { code: doc.paymentAccountCode },
      select: { code: true, name: true },
    });

    const html = await this.renderHtml(doc, company, payAccount);

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      // C15 fix: fonts are now self-hosted (base64 data: URIs embedded in the
      // HTML), so there are zero outbound network requests. Wait only for the
      // HTML document to parse — no need for `networkidle0` + 8s fallback.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.evaluate('document.fonts.ready');
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private async renderHtml(
    doc: DocWithItems,
    company: { nameTh: string; taxId: string | null; address: string | null; phone: string | null } | null,
    payAccount: { code: string; name: string } | null,
  ): Promise<string> {
    const verifyUrl = `https://bestchoicephone.app/other-income/${doc.id}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 260,
      color: { dark: '#18181b', light: '#ffffff' },
    });

    const safe = {
      companyName: escapeHtml(company?.nameTh) || 'บริษัท เบสท์ช้อยส์ ไฟแนนท์ จำกัด',
      companyAddress: escapeHtml(formatAddress(company?.address)),
      companyPhone: escapeHtml(company?.phone),
      taxId: escapeHtml(company?.taxId),
      payerName: escapeHtml(doc.customer?.name || doc.counterpartyName || '—'),
      payerAddress: escapeHtml(formatAddress(doc.counterpartyAddress)),
      payerTaxId: escapeHtml(doc.counterpartyTaxId),
      payerPhone: escapeHtml(doc.counterpartyPhone || doc.customer?.phone || ''),
      receiptNumber: escapeHtml(doc.receiptNo || doc.docNumber),
      refDocNumber: doc.receiptNo ? escapeHtml(doc.docNumber) : '',
      issueDateStr: fmtDateShort(doc.issueDate),
      paymentDateStr: doc.paymentDate ? fmtDateShort(doc.paymentDate) : fmtDateShort(doc.issueDate),
      paymentAccountCode: escapeHtml(doc.paymentAccountCode),
      paymentAccountName: escapeHtml(payAccount?.name),
      customerNote: escapeHtml(doc.customerNote),
      issuerName: escapeHtml(doc.createdBy?.name) || 'ระบบ',
      issuerSignName: escapeHtml((doc.createdBy?.name || '').split(/\s+/)[0]) || 'ระบบ',
      issuerEmail: escapeHtml(doc.createdBy?.email),
    };

    const incomeGross = Number(doc.incomeGross);
    const vatAmount = Number(doc.vatAmount);
    const whtAmount = Number(doc.whtAmount);
    const totalAmount = Number(doc.totalAmount);
    const amountReceived = Number(doc.amountReceived);
    const thaiAmount = numberToThaiText(totalAmount);
    // "Partial" is measured against what the payer owes after withholding tax — a payer who
    // withholds ภ.ง.ด. has paid in full, and the WHT line below already explains the gap
    // (DOC-05 #1564: comparing with totalAmount printed ชำระเงินบางส่วน on every WHT receipt).
    const dueAfterWht = totalAmount - whtAmount;
    const isPartial = dueAfterWht - amountReceived >= 0.01;
    const isReversed = doc.status === 'REVERSED';

    const itemsHtml = (doc.items || [])
      .map((it, idx) => {
        const qty = Number(it.quantity);
        const unit = Number(it.unitAmount);
        const disc = Number(it.discountAmount);
        const vatPct = Number(it.vatPct);
        const beforeVat = Number(it.amountBeforeVat);
        return `
          <tr>
            <td class="no">${idx + 1}.</td>
            <td>
              <div><span class="item-name">${escapeHtml(it.accountName)}</span> <span class="item-code">(${escapeHtml(it.accountCode)})</span></div>
              ${it.description ? `<div class="item-meta">${escapeHtml(it.description)}</div>` : ''}
            </td>
            <td class="right">${fmtMoney(qty)}</td>
            <td class="right">${fmtMoney(unit)}</td>
            <td class="right">${fmtMoney(disc)}</td>
            <td class="right">${vatPct > 0 ? `${vatPct}%` : '-'}</td>
            <td class="right">${fmtMoney(beforeVat)}</td>
          </tr>`;
      })
      .join('');

    const embeddedFontCss = embeddedDocumentFonts();

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
${embeddedFontCss}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.item-name { font-weight: 700; } .item-meta { color: #52645d; }
.items { table-layout: fixed; } .items th:first-child { width: 6mm; }
.items td.right { white-space: nowrap; }
.bc-doc-approval { grid-auto-flow: initial; grid-template-columns: repeat(3,minmax(0,1fr)) 24mm; }
.void-overlay { position: fixed; inset: 45% 0 auto; text-align: center; transform: rotate(-20deg); color: rgba(185,28,28,.18); }
.items th:nth-child(3) { width: 16mm; } .items th:nth-child(4) { width: 24mm; } .items th:nth-child(5) { width: 20mm; } .items th:nth-child(6) { width: 12mm; } .items th:nth-child(7) { width: 26mm; }
.bc-doc-approval { grid-template-columns: 24mm minmax(0,1fr) minmax(0,1fr); }
${PAPER_SPACING_CSS}
</style>
</head>
<body data-bc-paper>
${isReversed ? `<div class="void-overlay">VOID / กลับรายการ</div>` : ''}<div class="bc-doc-header">
  <div class="bc-doc-brand"><div>${BESTCHOICE_LOGO_SVG}</div><p class="bc-doc-company">${safe.companyName}</p>
    <p>${safe.companyAddress}</p><p>เลขประจำตัวผู้เสียภาษี ${safe.taxId}</p>${safe.companyPhone ? `<p>โทร ${safe.companyPhone}</p>` : ''}
  </div>
  <div class="bc-doc-identity"><h1>ใบเสร็จรับเงิน / ใบกำกับภาษี</h1><p class="bc-doc-kicker">RECEIPT / TAX INVOICE · ต้นฉบับ</p>
    <div class="bc-doc-meta"><span>เลขที่เอกสาร</span><span>${safe.receiptNumber}</span><span>วันที่</span><span>${safe.issueDateStr}</span>${safe.refDocNumber ? `<span>อ้างอิง</span><span>${safe.refDocNumber}</span>` : ''}</div></div></div>
<div class="bc-doc-parties"><div><p class="bc-doc-label">ลูกค้า / ผู้ชำระเงิน</p><strong>${safe.payerName}</strong><p>${safe.payerAddress}</p>${safe.payerTaxId ? `<p>เลขที่ภาษี ${safe.payerTaxId}</p>` : ''}${safe.payerPhone ? `<p>โทร ${safe.payerPhone}</p>` : ''}</div>
<div><p class="bc-doc-label">การรับชำระเงิน</p><div class="bc-doc-kv"><span>วันที่ชำระ</span><span>${safe.paymentDateStr}</span><span>บัญชีรับเงิน</span><span>${safe.paymentAccountName || safe.paymentAccountCode}</span><span>รหัสบัญชี</span><span>${safe.paymentAccountCode}</span></div></div></div>
<table class="items"><thead><tr><th>#</th><th>รายการ</th><th class="right">จำนวน</th><th class="right">ราคา</th><th class="right">ส่วนลด</th><th class="right">VAT</th><th class="right">ก่อนภาษี</th></tr></thead><tbody>${itemsHtml}</tbody></table>
${safe.customerNote ? `<p class="bc-doc-note"><strong>หมายเหตุ</strong> ${safe.customerNote}</p>` : ''}
<div class="bc-doc-closing">
<div class="bc-doc-total-grid"><div><p class="bc-doc-label">จำนวนเงิน (ตัวอักษร)</p><strong>${thaiAmount}</strong>${isPartial ? `<p class="bc-doc-note">ชำระเงินบางส่วน ${fmtMoney(amountReceived)} / ${fmtMoney(dueAfterWht)} บาท</p>` : ''}</div>
<div><div class="bc-doc-totals"><span>มูลค่าก่อนภาษี</span><span>${fmtMoney(incomeGross)}</span><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${fmtMoney(vatAmount)}</span><span>จำนวนเงินทั้งสิ้น</span><span>${fmtMoney(totalAmount)}</span>${whtAmount > 0 ? `<span>หัก ณ ที่จ่าย</span><span>${fmtMoney(whtAmount)}</span>` : ''}</div><div class="bc-doc-grand"><span>จำนวนเงินที่ชำระ</span><span>${fmtMoney(amountReceived)} บาท</span></div></div></div>
<div class="bc-doc-approval"><div class="bc-doc-qr"><img src="${qrDataUrl}" alt="ตรวจสอบเอกสาร"/><p class="bc-doc-kicker">สแกนเพื่อตรวจสอบ</p></div><div><p class="bc-doc-label">ติดต่อผู้ออกเอกสาร</p><p>${safe.issuerName}</p><p>${safe.issuerEmail}</p></div><div class="bc-doc-signature"><div class="sign-space">${safe.issuerSignName}</div><strong>${safe.issuerName}</strong><p>ผู้ออกใบเสร็จรับเงิน</p><p class="bc-doc-kicker">${safe.paymentDateStr}</p></div></div>
<footer class="bc-doc-footer"><span>${safe.receiptNumber}</span><span>ออกโดยระบบ BESTCHOICE</span></footer></div>
${paperSpacingScript()}
</body>
</html>`;
  }
}
