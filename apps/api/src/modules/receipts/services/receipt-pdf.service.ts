import { formatDateShort } from '../../../utils/thai-date.util';
import { Prisma } from '@prisma/client';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { EMBEDDED_FONT_FACES } from '../../../assets/fonts/embedded-fonts';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';
import { ReceiptQueryService } from './receipt-query.service';

// Embedded BESTCHOICE logo. Single source of truth for the receipt header.
// Loaded inline so the PDF renders without network access.
const BESTCHOICE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="395 285 710 425" fill="none"><defs><linearGradient id="bc" gradientUnits="userSpaceOnUse" x1="597.6" y1="434.1" x2="902.4" y2="434.1"><stop offset="0" stop-color="#39F0CF"/><stop offset="0.5" stop-color="#25BC93"/><stop offset="1" stop-color="#1DA579"/></linearGradient></defs><path fill="url(#bc)" d="M 603.769531 297.347656 C 600.023438 298.191406 597.769531 301.1875 597.597656 305.820312 C 597.414062 310.808594 599.695312 314.0625 603.605469 315.121094 C 605.0625 315.515625 606.605469 315.484375 608.132812 315.453125 C 608.550781 315.445312 608.96875 315.4375 609.382812 315.4375 C 623.914062 315.445312 638.449219 315.445312 652.980469 315.445312 C 662.1875 315.445312 671.390625 315.445312 680.59375 315.445312 C 692.277344 315.449219 696.074219 321.558594 693.207031 335.660156 C 687.417969 364.132812 681.613281 392.601562 675.878906 421.089844 C 673.085938 434.941406 678.320312 443.273438 689.765625 443.289062 C 717.367188 443.324219 744.976562 443.292969 772.582031 443.335938 C 782.101562 443.351562 785.0625 447.972656 782.789062 459.183594 C 777.746094 484.074219 772.6875 508.957031 767.59375 533.832031 C 764.777344 547.605469 759.269531 552.824219 747.617188 552.828125 C 701.550781 552.84375 655.484375 552.839844 609.414062 552.847656 C 608.996094 552.847656 608.578125 552.84375 608.160156 552.835938 C 606.816406 552.820312 605.472656 552.800781 604.144531 552.976562 C 599.992188 553.523438 597.800781 556.847656 597.597656 561.664062 C 597.402344 566.289062 599.542969 569.574219 603.199219 570.730469 C 604.714844 571.210938 606.347656 571.191406 607.960938 571.171875 C 608.292969 571.164062 608.628906 571.160156 608.960938 571.160156 C 650.808594 571.183594 692.65625 571.175781 734.503906 571.179688 C 776.878906 571.183594 819.257812 571.214844 861.632812 571.164062 C 873.066406 571.152344 879.71875 564.628906 882.480469 551.023438 C 888.8125 519.808594 895.195312 488.605469 901.441406 457.363281 C 905.367188 437.703125 897.210938 424.992188 880.769531 424.957031 C 868.933594 424.933594 857.101562 424.9375 845.265625 424.941406 C 833.714844 424.945312 822.164062 424.949219 810.613281 424.925781 C 799.550781 424.90625 794.933594 417.503906 797.613281 404.195312 C 802.675781 379.085938 807.78125 353.988281 812.839844 328.878906 C 816.617188 310.132812 808.339844 297.125 792.601562 297.121094 C 731.234375 297.097656 669.867188 297.109375 608.503906 297.117188 C 607.859375 297.117188 607.214844 297.097656 606.566406 297.097656 C 605.625 297.097656 604.683594 297.140625 603.769531 297.347656"/><path fill="#4D4D4D" d="M 434.851562 645.261719 L 432.128906 658.890625 L 446.460938 658.890625 C 450.027344 658.890625 452.738281 658.199219 454.589844 656.820312 C 456.4375 655.441406 457.363281 653.441406 457.363281 650.816406 C 457.363281 647.117188 454.570312 645.261719 448.984375 645.261719 Z M 452.214844 684.933594 C 454.234375 683.523438 455.246094 681.4375 455.246094 678.675781 C 455.246094 676.65625 454.503906 675.160156 453.023438 674.183594 C 451.542969 673.207031 449.523438 672.71875 446.964844 672.71875 L 429.300781 672.71875 L 426.476562 687.054688 L 443.835938 687.054688 C 447.402344 687.054688 450.199219 686.347656 452.214844 684.933594 M 472.65625 670.652344 C 474.304688 673.039062 475.128906 675.851562 475.128906 679.078125 C 475.128906 686.414062 472.136719 691.984375 466.148438 695.785156 C 460.15625 699.589844 452.351562 701.488281 442.726562 701.488281 L 403.863281 701.488281 L 417.996094 630.828125 L 453.730469 630.828125 C 461.667969 630.828125 467.746094 632.257812 471.949219 635.117188 C 476.15625 637.980469 478.257812 642.066406 478.257812 647.382812 C 478.257812 651.488281 477.148438 655.039062 474.929688 658.03125 C 472.707031 661.027344 469.613281 663.367188 465.640625 665.046875 C 468.667969 666.394531 471.007812 668.261719 472.65625 670.652344"/><path fill="#4D4D4D" d="M 512.175781 646.273438 L 509.855469 658.183594 L 541.25 658.183594 L 538.320312 673.125 L 506.828125 673.125 L 504.304688 686.042969 L 541.351562 686.042969 L 538.121094 701.488281 L 481.488281 701.488281 L 495.621094 630.828125 L 550.941406 630.828125 L 547.808594 646.273438 Z"/><path fill="#4D4D4D" d="M 559.015625 700.78125 C 553.765625 699.371094 549.492188 697.554688 546.195312 695.332031 L 554.070312 680.390625 C 557.632812 682.679688 561.4375 684.414062 565.472656 685.589844 C 569.511719 686.769531 573.550781 687.355469 577.589844 687.355469 C 581.425781 687.355469 584.402344 686.800781 586.523438 685.691406 C 588.640625 684.582031 589.703125 683.050781 589.703125 681.097656 C 589.703125 679.417969 588.742188 678.105469 586.824219 677.164062 C 584.90625 676.21875 581.929688 675.210938 577.890625 674.132812 C 573.3125 672.921875 569.511719 671.695312 566.484375 670.449219 C 563.457031 669.203125 560.847656 667.304688 558.660156 664.746094 C 556.472656 662.1875 555.378906 658.824219 555.378906 654.652344 C 555.378906 649.601562 556.757812 645.179688 559.519531 641.378906 C 562.277344 637.574219 566.214844 634.632812 571.328125 632.542969 C 576.445312 630.460938 582.433594 629.414062 589.296875 629.414062 C 594.34375 629.414062 599.054688 629.9375 603.429688 630.980469 C 607.804688 632.023438 611.574219 633.519531 614.738281 635.472656 L 607.46875 650.308594 C 604.707031 648.5625 601.664062 647.230469 598.332031 646.324219 C 595.003906 645.414062 591.585938 644.960938 588.085938 644.960938 C 584.117188 644.960938 581.003906 645.601562 578.75 646.878906 C 576.492188 648.15625 575.367188 649.804688 575.367188 651.824219 C 575.367188 653.574219 576.34375 654.921875 578.296875 655.863281 C 580.246094 656.804688 583.273438 657.816406 587.378906 658.890625 C 591.957031 660.035156 595.742188 661.210938 598.738281 662.425781 C 601.730469 663.636719 604.304688 665.484375 606.460938 667.976562 C 608.613281 670.464844 609.6875 673.730469 609.6875 677.765625 C 609.6875 682.75 608.292969 687.140625 605.5 690.941406 C 602.707031 694.742188 598.738281 697.6875 593.589844 699.773438 C 588.441406 701.859375 582.464844 702.902344 575.671875 702.902344 C 569.816406 702.902344 564.261719 702.195312 559.015625 700.78125"/><path fill="#4D4D4D" d="M 639.566406 646.675781 L 617.863281 646.675781 L 621.09375 630.828125 L 684.386719 630.828125 L 681.15625 646.675781 L 659.554688 646.675781 L 648.550781 701.488281 L 628.566406 701.488281 Z"/><path fill="#1DA579" d="M 717.195312 686.347656 C 711.878906 686.347656 707.671875 684.902344 704.574219 682.007812 C 701.480469 679.113281 699.933594 675.277344 699.933594 670.5 C 699.933594 665.855469 700.890625 661.667969 702.808594 657.933594 C 704.726562 654.195312 707.402344 651.269531 710.835938 649.148438 C 714.265625 647.03125 718.238281 645.96875 722.746094 645.96875 C 729.675781 645.96875 734.859375 648.730469 738.292969 654.246094 L 752.726562 642.738281 C 750.234375 638.5 746.46875 635.21875 741.421875 632.898438 C 736.375 630.578125 730.585938 629.414062 724.058594 629.414062 C 715.441406 629.414062 707.769531 631.230469 701.042969 634.867188 C 694.3125 638.5 689.082031 643.546875 685.347656 650.007812 C 681.609375 656.46875 679.742188 663.738281 679.742188 671.8125 C 679.742188 677.9375 681.191406 683.355469 684.085938 688.0625 C 686.976562 692.777344 691.117188 696.425781 696.5 699.015625 C 701.882812 701.605469 708.140625 702.902344 715.277344 702.902344 C 721.871094 702.902344 727.726562 701.875 732.839844 699.824219 C 737.953125 697.773438 742.429688 694.421875 746.265625 689.78125 L 734.457031 678.171875 C 729.675781 683.621094 723.921875 686.347656 717.195312 686.347656"/><path fill="#1DA579" d="M 807.234375 657.277344 L 780.082031 657.277344 L 785.332031 630.828125 L 765.34375 630.828125 L 751.210938 701.488281 L 771.199219 701.488281 L 776.648438 674.03125 L 803.804688 674.03125 L 798.351562 701.488281 L 818.339844 701.488281 L 832.472656 630.828125 L 812.484375 630.828125 Z"/><path fill="#1DA579" d="M 891.929688 674.082031 C 890.109375 677.816406 887.519531 680.796875 884.15625 683.015625 C 880.789062 685.238281 876.886719 686.347656 872.445312 686.347656 C 867.195312 686.347656 863.109375 684.917969 860.179688 682.058594 C 857.253906 679.199219 855.789062 675.378906 855.789062 670.601562 C 855.789062 666.09375 856.699219 661.96875 858.515625 658.234375 C 860.332031 654.5 862.921875 651.519531 866.289062 649.300781 C 869.652344 647.078125 873.554688 645.96875 877.996094 645.96875 C 883.246094 645.96875 887.335938 647.398438 890.261719 650.261719 C 893.191406 653.121094 894.652344 656.9375 894.652344 661.71875 C 894.652344 666.226562 893.746094 670.347656 891.929688 674.082031 M 898.339844 633.351562 C 893.054688 630.726562 886.847656 629.414062 879.714844 629.414062 C 871.167969 629.414062 863.546875 631.230469 856.851562 634.867188 C 850.152344 638.5 844.9375 643.546875 841.203125 650.007812 C 837.46875 656.46875 835.601562 663.734375 835.601562 671.8125 C 835.601562 677.867188 837.03125 683.253906 839.890625 687.964844 C 842.75 692.675781 846.820312 696.339844 852.105469 698.964844 C 857.386719 701.589844 863.597656 702.902344 870.730469 702.902344 C 879.273438 702.902344 886.898438 701.085938 893.59375 697.449219 C 900.289062 693.816406 905.503906 688.769531 909.238281 682.308594 C 912.976562 675.851562 914.84375 668.582031 914.84375 660.507812 C 914.84375 654.449219 913.410156 649.066406 910.550781 644.355469 C 907.691406 639.644531 903.621094 635.976562 898.339844 633.351562"/><path fill="#1DA579" d="M 917.972656 701.488281 L 937.957031 701.488281 L 952.089844 630.828125 L 932.101562 630.828125 Z"/><path fill="#1DA579" d="M 992.667969 686.347656 C 987.351562 686.347656 983.144531 684.902344 980.050781 682.007812 C 976.957031 679.113281 975.40625 675.277344 975.40625 670.5 C 975.40625 665.855469 976.367188 661.667969 978.285156 657.933594 C 980.203125 654.195312 982.878906 651.269531 986.308594 649.148438 C 989.742188 647.03125 993.710938 645.96875 998.222656 645.96875 C 1005.152344 645.96875 1010.335938 648.730469 1013.765625 654.246094 L 1028.203125 642.738281 C 1025.710938 638.5 1021.945312 635.21875 1016.894531 632.898438 C 1011.847656 630.578125 1006.058594 629.414062 999.535156 629.414062 C 990.917969 629.414062 983.246094 631.230469 976.519531 634.867188 C 969.789062 638.5 964.554688 643.546875 960.820312 650.007812 C 957.085938 656.46875 955.21875 663.738281 955.21875 671.8125 C 955.21875 677.9375 956.664062 683.355469 959.558594 688.0625 C 962.453125 692.777344 966.589844 696.425781 971.976562 699.015625 C 977.359375 701.605469 983.617188 702.902344 990.75 702.902344 C 997.347656 702.902344 1003.199219 701.875 1008.316406 699.824219 C 1013.429688 697.773438 1017.90625 694.421875 1021.742188 689.78125 L 1009.929688 678.171875 C 1005.152344 683.621094 999.398438 686.347656 992.667969 686.347656"/><path fill="#1DA579" d="M 1093.007812 646.273438 L 1096.136719 630.828125 L 1040.820312 630.828125 L 1026.6875 701.488281 L 1083.316406 701.488281 L 1086.546875 686.042969 L 1049.5 686.042969 L 1052.023438 673.125 L 1083.519531 673.125 L 1086.445312 658.183594 L 1055.050781 658.183594 L 1057.375 646.273438 Z"/></svg>`;

/**
 * Pure receipt PDF rendering. Zero DB writes — reads the receipt via
 * ReceiptQueryService.getReceipt, then renders the Thai tax-invoice layout
 * through Puppeteer.
 */
export class ReceiptPdfService {
  constructor(private query: ReceiptQueryService) {}

  /** Parse a JSON address blob (or plain string) and render as a single Thai line. */
  private formatAddress(value: string | null | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return trimmed;
    try {
      const addr = JSON.parse(trimmed) as Record<string, string | undefined>;
      if (typeof addr !== 'object' || addr === null) return trimmed;
      if (addr.raw && !addr.province) return addr.raw;
      const parts: string[] = [];
      if (addr.houseNo) parts.push(addr.houseNo);
      if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
      if (addr.village) parts.push(`หมู่บ้าน ${addr.village}`);
      if (addr.soi) parts.push(`ซอย ${addr.soi}`);
      if (addr.road) parts.push(`ถนน ${addr.road}`);
      if (addr.subdistrict) parts.push(addr.subdistrict);
      if (addr.district) parts.push(addr.district);
      if (addr.province) parts.push(addr.province);
      if (addr.postalCode) parts.push(addr.postalCode);
      return parts.length > 0 ? parts.join(' ') : trimmed;
    } catch {
      return trimmed;
    }
  }

  /** Escape HTML special characters to prevent XSS in PDF templates */
  private escapeHtml(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** Convert a non-negative number to its Thai-baht spelling. e.g. 1926 → "หนึ่งพันเก้าร้อยยี่สิบหกบาทถ้วน" */
  private numberToThaiText(num: number): string {
    if (num === 0) return 'ศูนย์บาทถ้วน';

    const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

    const readGroup = (n: number): string => {
      if (n === 0) return '';
      let s = '';
      const str = String(Math.floor(n));
      const len = str.length;
      for (let i = 0; i < len; i++) {
        const d = parseInt(str[i]);
        const place = len - i - 1;
        if (d === 0) continue;
        if (place === 1 && d === 1) {
          s += 'สิบ';
        } else if (place === 1 && d === 2) {
          s += 'ยี่สิบ';
        } else if (place === 0 && d === 1 && len > 1) {
          s += 'เอ็ด';
        } else {
          s += digits[d] + places[place];
        }
      }
      return s;
    };

    let text = '';
    let remaining = Math.floor(num);
    if (remaining >= 1000000) {
      const millions = Math.floor(remaining / 1000000);
      text += readGroup(millions) + 'ล้าน';
      remaining = remaining - millions * 1000000;
    }
    if (remaining > 0) text += readGroup(remaining);
    text += 'บาท';

    const satang = Math.round((num - Math.floor(num)) * 100);
    if (satang === 0) {
      text += 'ถ้วน';
    } else {
      text += readGroup(satang) + 'สตางค์';
    }
    return text;
  }

  /**
   * Generate the e-Receipt PDF using Puppeteer + the Thai tax-invoice layout.
   * The HTML template is intentionally inlined (no external assets) so the
   * renderer works in air-gapped Cloud Run revisions and offline tests.
   */
  async generatePDF(id: string): Promise<Buffer> {
    const receipt = await this.query.getReceipt(id);

    // Payment method labels (matches Prisma PaymentMethod enum)
    const methodLabels: Record<string, string> = {
      CASH: 'เงินสด',
      BANK_TRANSFER: 'โอนเงินผ่านธนาคาร',
      QR_EWALLET: 'QR / e-Wallet',
      CARD: 'บัตร (EDC)',
      CREDIT_BALANCE: 'ใช้ยอดเครดิตในสัญญา',
      ONLINE_GATEWAY: 'ชำระออนไลน์',
    };
    // "บัญชีรับเงิน <ธนาคารบริษัท>" only makes sense when the money actually
    // lands in the company bank account. Cash / credit-balance receipts must
    // not display it — a tax document claiming a bank deposit for a cash
    // payment is misleading. CARD is bank-bound: EDC settles into the selected
    // bank account (schema PaymentMethod comment — no card suspense account).
    const bankBoundMethods = new Set(['BANK_TRANSFER', 'QR_EWALLET', 'CARD', 'ONLINE_GATEWAY']);
    const showBankAccount = bankBoundMethods.has(receipt.paymentMethod ?? '');

    const customer = receipt.contract?.customer;
    // Pick the best raw address source, then format JSON-blob addresses to a flat Thai line.
    const rawPayerAddress =
      receipt.payerAddress ||
      customer?.addressIdCard ||
      customer?.addressCurrent ||
      '';
    const safe = {
      companyName: this.escapeHtml(receipt.company?.nameTh) || 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      companyAddress: this.escapeHtml(this.formatAddress(receipt.company?.address)),
      companyPhone: this.escapeHtml(receipt.company?.phone),
      taxId: this.escapeHtml(receipt.company?.taxId),
      payerName: this.escapeHtml(receipt.payerName),
      payerAddress: this.escapeHtml(this.formatAddress(rawPayerAddress)),
      payerTaxId: this.escapeHtml(receipt.payerTaxId) || this.escapeHtml(customer?.nationalId),
      customerPhone: this.escapeHtml(customer?.phone),
      customerEmail: this.escapeHtml(customer?.email),
      contractNumber: this.escapeHtml(receipt.contract?.contractNumber),
      productName: this.escapeHtml(receipt.contract?.product?.name),
      imeiSerial: this.escapeHtml(receipt.contract?.product?.imeiSerial),
      serialNumber: this.escapeHtml(receipt.contract?.product?.serialNumber),
      branchName: this.escapeHtml(receipt.contract?.branch?.name),
      branchPhone: this.escapeHtml(receipt.contract?.branch?.phone),
      receiptNumber: this.escapeHtml(receipt.receiptNumber),
      paymentMethodLabel: methodLabels[receipt.paymentMethod ?? ''] ?? this.escapeHtml(receipt.paymentMethod),
      transactionRef: this.escapeHtml(receipt.transactionRef),
      bankName: this.escapeHtml(receipt.company?.bankName),
      bankAccountName: this.escapeHtml(receipt.company?.bankAccountName),
      bankAccountNumber: this.escapeHtml(receipt.company?.bankAccountNumber),
      issuerName: this.escapeHtml(receipt.issuer?.name) || 'ระบบอัตโนมัติ',
      issuerSignName:
        this.escapeHtml((receipt.issuer?.name || '').split(/\s+/)[0]) || 'ระบบ',
    };

    // I2 fix: route money math through Prisma.Decimal — Number(amountDue) +
    // Number(lateFee) accumulated drift on receipts with fractional satang.
    // Display uses .toFixed(2) before Intl.NumberFormat so the print output
    // is satang-accurate even when the source columns ran through several
    // additions.
    const toDec = (v: unknown): Prisma.Decimal =>
      new Prisma.Decimal((v ?? 0).toString());
    const ZERO = new Prisma.Decimal(0);
    const total = toDec(receipt.amount);
    const totalDue = receipt.payment
      ? toDec(receipt.payment.amountDue).plus(
          receipt.payment.lateFeeWaived ? ZERO : toDec(receipt.payment.lateFee),
        )
      : null;
    // Partial-payment context: prefer the receipt's own issuance-time
    // snapshot (paymentStatus / remainingAmount) over live Payment state —
    // voiding a later sibling resets Payment.amountPaid to 0, which used to
    // erase the "ชำระบางส่วน" tag from re-generated historical PDFs. The
    // snapshot is only trusted on installment-money receipts (fee/payoff
    // documents also carry a PARTIAL snapshot but must never show the tag).
    const isInstallmentReceipt = (INSTALLMENT_MONEY_RECEIPT_TYPES as readonly string[]).includes(
      receipt.receiptType ?? 'PAYMENT',
    );
    const snapshotPartial = isInstallmentReceipt && receipt.paymentStatus === 'PARTIAL';
    const livePartial = isInstallmentReceipt && receipt.payment?.status === 'PARTIALLY_PAID';
    const isPartial = snapshotPartial || livePartial;
    // Cumulative paid on this installment: while the installment is still
    // live-partial, Payment.amountPaid is exact — keep it. Once live state
    // no longer reflects this receipt (sibling voided → amountPaid reset,
    // or installment completed later), reconstruct the issuance-time value
    // from the immutable snapshot: amountDue − remainingAmount. Legacy rows
    // without the snapshot fall back to live amountPaid (old behavior).
    // Sanity guard on the reconstruction: rows written before the
    // INSTALLMENT-type filter existed can carry a remainingAmount corrupted
    // by credit-note/fee amounts (e.g. remaining=0 on a genuinely-partial
    // receipt → reconstruction = full amountDue, contradicting PARTIAL).
    // When the snapshot contradicts itself, fall back to live amountPaid.
    const snapshotCumulative =
      snapshotPartial && receipt.payment && receipt.remainingAmount != null
        ? toDec(receipt.payment.amountDue).minus(toDec(receipt.remainingAmount))
        : null;
    const snapshotSane =
      snapshotCumulative != null &&
      receipt.payment != null &&
      snapshotCumulative.gt(0) &&
      snapshotCumulative.lt(toDec(receipt.payment.amountDue));
    const totalPaidOnInstallment = receipt.payment
      ? livePartial
        ? toDec(receipt.payment.amountPaid)
        : snapshotSane && snapshotCumulative != null
          ? snapshotCumulative
          : toDec(receipt.payment.amountPaid)
      : null;
    const remainingBalance = toDec(receipt.remainingBalance ?? 0);
    const fmt = (v: Prisma.Decimal | number) =>
      (typeof v === 'number' ? v : v.toNumber()).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const thaiAmount = this.numberToThaiText(total.toNumber());
    const paidDateStr = formatDateShort(receipt.paidDate);

    // ── CPA money breakdown (คู่มือบันทึกรับชำระ Policy A) ─────────────────
    // ค่างวดมี VAT 7% ฝังใน (Gross/งวด + VAT/งวด เช่น 1,416.66 + 99.17 =
    // 1,515.83) ส่วนค่าปรับล่าช้าไม่มี VAT (นโยบาย owner + ฐานภาษีตามกฎหมาย)
    // — ใบเสร็จจึงต้องแยกสองส่วนนี้คนละบรรทัด ห้ามรวมฐาน.
    const receiptType = receipt.receiptType ?? 'PAYMENT';
    const isCreditNote = receiptType === 'CREDIT_NOTE';
    // VAT-bearing documents: installment receipts + early payoff (JP4 settles
    // VAT) + credit notes (mirror of an installment receipt). Down payments
    // (SHOP — ไม่จด VAT) and reschedule fees (เงินรับล่วงหน้า + ค่าปรับ) carry no VAT.
    const vatBearing = !['DOWN_PAYMENT', 'RESCHEDULE_FEE'].includes(receiptType);

    // Late fee — first receipt of the installment only (owner convention
    // 2026-07-02, mirrors the payment-history display). Fee is VAT-exempt.
    const firstReceiptOfInstallment = (receipt.priorReceiptCount ?? 0) === 0;
    const rawFee =
      receipt.payment && !isCreditNote && firstReceiptOfInstallment
        ? toDec(receipt.payment.lateFee)
        : ZERO;
    const feeWaived =
      receipt.payment && !isCreditNote && firstReceiptOfInstallment
        ? receipt.payment.waivedAmount != null
          ? toDec(receipt.payment.waivedAmount)
          : receipt.payment.lateFeeWaived
            ? rawFee
            : ZERO
        : ZERO;
    const feeCharged = rawFee.gt(0) ? rawFee : ZERO;
    const feeNet = Prisma.Decimal.max(feeCharged.minus(feeWaived), ZERO);
    // Cash attributed to the fee cannot exceed what was actually received.
    const feePortion = Prisma.Decimal.min(feeNet, total);

    // Installment (VAT-bearing) portion of this receipt's cash.
    const installmentPortion = total.minus(feePortion);
    const breakdown =
      receipt.contract?.financedAmount != null && receipt.contract?.totalMonths
        ? computeInstallmentBreakdown({
            financedAmount: receipt.contract.financedAmount.toString(),
            storeCommission:
              receipt.contract.storeCommission != null
                ? receipt.contract.storeCommission.toString()
                : null,
            interestTotal: (receipt.contract.interestTotal ?? 0).toString(),
            vatAmount:
              receipt.contract.vatAmount != null ? receipt.contract.vatAmount.toString() : null,
            totalMonths: receipt.contract.totalMonths,
          })
        : null;
    let exclVat = ZERO;
    let vatPart = ZERO;
    if (vatBearing && installmentPortion.gt(0)) {
      if (breakdown && installmentPortion.equals(breakdown.installmentTotal)) {
        // Full standard installment → exact ledger figures (per CPA manual).
        exclVat = breakdown.installmentExclVat;
        vatPart = breakdown.vatPerInst;
      } else {
        // Partial / payoff / residual final installment → pro-rata 7% split.
        exclVat = installmentPortion.times(100).div(107).toDecimalPlaces(2);
        vatPart = installmentPortion.minus(exclVat);
      }
    } else if (installmentPortion.gt(0)) {
      exclVat = installmentPortion; // non-VAT document — full value, no VAT column
    }

    const docTitle = isCreditNote
      ? 'ใบลดหนี้'
      : vatBearing && vatPart.gt(0)
        ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี'
        : 'ใบเสร็จรับเงิน';

    const itemLabels: Record<string, string> = {
      DOWN_PAYMENT: 'เงินดาวน์',
      EARLY_PAYOFF: 'ปิดยอดสัญญาก่อนกำหนด',
      RESCHEDULE_FEE: 'ค่าธรรมเนียมเลื่อนนัดชำระ (ปรับดิว)',
      CREDIT_NOTE: 'ลดหนี้ — ยกเลิกใบเสร็จ',
    };
    const installmentLabel = receipt.installmentNo
      ? `ค่างวดเช่าซื้อ งวดที่ ${receipt.installmentNo}${receipt.contract?.totalMonths ? `/${receipt.contract.totalMonths}` : ''}`
      : 'การรับชำระเงิน';
    const itemLabel = itemLabels[receiptType] ?? installmentLabel;

    const verifyUrl = `https://bestchoicephone.app/r/${receipt.receiptNumber}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 260,
      color: { dark: '#18181b', light: '#ffffff' },
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    // C5 fix (round 2): self-host Thai fonts via base64-embedded @font-face.
    // Cloud Run's `node:20-slim` and the puppeteer-bundled Chromium do NOT
    // ship Thai fonts — without these embedded faces every Thai glyph
    // renders as a tofu box. Fonts are loaded once at module init from
    // `apps/api/src/assets/fonts/` (bundled into dist via nest-cli.json).
    // Keep `domcontentloaded/10s` wait — no network assets remain.
    const html = `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
    ${EMBEDDED_FONT_FACES}
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --emerald-50:#ecfdf5; --emerald-100:#d1fae5; --emerald-600:#059669; --emerald-700:#047857; --emerald-800:#065f46; --emerald-900:#064e3b;
      --zinc-50:#fafafa; --zinc-100:#f4f4f5; --zinc-200:#e4e4e7; --zinc-300:#d4d4d8; --zinc-400:#a1a1aa; --zinc-500:#71717a; --zinc-600:#52525b; --zinc-700:#3f3f46; --zinc-900:#18181b;
      --amber-50:#fffbeb; --amber-200:#fde68a; --amber-800:#92400e;
    }
    body {
      font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif;
      color: var(--zinc-900);
      font-size: 10.5pt;
      line-height: 1.55;
      padding: 12mm 13mm 10mm;
    }
    .num, .tnum { font-variant-numeric: tabular-nums; }

    /* ── Header: identity left, document identity right ── */
    .header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding-bottom:12px; border-bottom:2.5px solid var(--emerald-700); }
    .logo-block svg { height:36px; width:auto; display:block; margin-bottom:8px; }
    .company-name { font-size:12.5pt; font-weight:700; }
    .company-line { font-size:9.5pt; color:var(--zinc-600); max-width:96mm; }
    .company-line strong { color:var(--zinc-700); font-weight:600; }
    .doc-block { text-align:right; }
    .doc-title { font-size:17pt; font-weight:800; color:var(--emerald-800); line-height:1.25; letter-spacing:-0.01em; }
    .doc-original { display:inline-block; margin-top:3px; font-size:8.5pt; font-weight:600; color:var(--emerald-700); border:1px solid var(--emerald-100); background:var(--emerald-50); border-radius:99px; padding:1px 10px; }
    .doc-meta { margin-top:8px; display:grid; grid-template-columns:auto auto; column-gap:12px; row-gap:2px; font-size:10pt; justify-content:end; }
    .doc-meta .k { color:var(--zinc-500); text-align:right; }
    .doc-meta .v { font-weight:700; text-align:right; font-variant-numeric:tabular-nums; }

    /* ── Parties ── */
    .parties { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:12px 0 14px; border-bottom:1px solid var(--zinc-200); }
    .party-heading { font-size:8.5pt; font-weight:700; letter-spacing:0.08em; color:var(--emerald-700); text-transform:uppercase; margin-bottom:4px; }
    .party-name { font-size:11.5pt; font-weight:700; }
    .party-line { font-size:9.5pt; color:var(--zinc-600); margin-top:1px; }
    .party-line strong { color:var(--zinc-700); font-weight:600; }

    /* ── Credit-note reference notice ── */
    .cn-notice { margin:10px 0 0; background:var(--amber-50); border:1px solid var(--amber-200); border-radius:8px; padding:8px 14px; font-size:10pt; color:var(--amber-800); }
    .cn-notice strong { font-weight:700; }

    /* ── Items table ── */
    table.items { width:100%; border-collapse:collapse; margin-top:14px; font-size:10.5pt; }
    table.items thead th { text-align:left; padding:8px 10px; background:var(--emerald-800); color:#fff; font-size:9.5pt; font-weight:600; }
    table.items thead th:first-child { border-radius:6px 0 0 0; }
    table.items thead th:last-child { border-radius:0 6px 0 0; }
    table.items thead th.right { text-align:right; }
    table.items tbody td { padding:9px 10px; border-bottom:1px solid var(--zinc-200); vertical-align:top; }
    table.items tbody td.right { text-align:right; font-variant-numeric:tabular-nums; }
    table.items tbody tr.alt td { background:var(--zinc-50); }
    .item-name { font-weight:700; }
    .item-meta { color:var(--zinc-500); font-size:9pt; margin-top:1px; }
    .vat-exempt { color:var(--zinc-500); font-size:9pt; }
    td.discount { color:var(--emerald-700); }

    /* ── Totals ── */
    .totals-wrap { display:grid; grid-template-columns:1fr 88mm; gap:18px; margin-top:12px; }
    .baht-text { font-size:10pt; color:var(--zinc-600); }
    .baht-text .label { font-size:8.5pt; font-weight:700; letter-spacing:0.08em; color:var(--zinc-500); text-transform:uppercase; display:block; margin-bottom:2px; }
    .baht-text .value { font-weight:600; color:var(--zinc-700); }
    .partial-tag { margin-top:10px; display:inline-block; font-size:9.5pt; color:var(--emerald-800); background:var(--emerald-50); border:1px solid var(--emerald-100); border-radius:6px; padding:4px 10px; }
    .totals { font-size:10.5pt; }
    .totals .row { display:flex; justify-content:space-between; gap:16px; padding:4px 2px; }
    .totals .row .k { color:var(--zinc-600); }
    .totals .row .v { font-weight:600; font-variant-numeric:tabular-nums; }
    .totals .row.sub { border-bottom:1px solid var(--zinc-200); }
    .grand { margin-top:6px; display:flex; justify-content:space-between; align-items:center; background:var(--emerald-800); color:#fff; border-radius:8px; padding:10px 14px; }
    .grand .k { font-size:10.5pt; font-weight:600; }
    .grand .v { font-size:16.5pt; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
    .grand .v .suffix { font-size:10pt; font-weight:500; margin-left:4px; }

    /* ── Payment / status block ── */
    .pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:14px; padding:12px 0; border-top:1px solid var(--zinc-200); border-bottom:1px solid var(--zinc-200); }
    .pay-col .heading { font-size:8.5pt; font-weight:700; letter-spacing:0.08em; color:var(--emerald-700); text-transform:uppercase; margin-bottom:4px; }
    .kv { display:grid; grid-template-columns:34mm 1fr; row-gap:2px; font-size:10pt; }
    .kv .k { color:var(--zinc-500); }
    .kv .v { font-weight:600; font-variant-numeric:tabular-nums; }

    /* ── Footer: QR + signature ── */
    .footer { display:grid; grid-template-columns:1fr 1fr 64mm; gap:18px; align-items:end; margin-top:16px; page-break-inside:avoid; break-inside:avoid; }
    .qr-pane { text-align:left; }
    .qr-pane img { width:88px; height:88px; display:block; }
    .qr-caption { font-size:8.5pt; color:var(--zinc-500); margin-top:4px; }
    .sig-block { text-align:center; }
    .sig-handwriting { font-family:'Sriracha', 'Apple Chancery', 'Brush Script MT', cursive; font-size:20pt; color:var(--zinc-600); line-height:1; transform:rotate(-3deg); display:inline-block; opacity:0.85; }
    .sig-rule { border-top:1px dotted var(--zinc-400); margin:6px 8px 5px; }
    .sig-name { font-size:10.5pt; font-weight:700; }
    .sig-role { font-size:9pt; color:var(--zinc-500); }
    .sig-date { font-size:9pt; color:var(--zinc-500); font-variant-numeric:tabular-nums; }
    .doc-note { grid-column:1 / -1; margin-top:10px; padding-top:8px; border-top:1px solid var(--zinc-200); font-size:8.5pt; color:var(--zinc-400); text-align:center; }

    .void-overlay { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-15deg); font-size:80pt; font-weight:900; color:rgba(220,38,38,0.18); letter-spacing:0.1em; pointer-events:none; }
  </style>
</head>
<body>
  ${receipt.isVoided ? `<div class="void-overlay">VOID / ยกเลิก</div>` : ''}

  <!-- Header: company identity + document identity -->
  <div class="header">
    <div>
      <div class="logo-block">${BESTCHOICE_LOGO_SVG}</div>
      <div class="company-name">${safe.companyName}</div>
      ${safe.companyAddress ? `<div class="company-line">${safe.companyAddress}</div>` : ''}
      <div class="company-line">
        ${safe.taxId ? `<strong>เลขประจำตัวผู้เสียภาษี</strong> ${safe.taxId}` : ''}
        ${safe.companyPhone ? ` &nbsp;·&nbsp; <strong>โทร</strong> ${safe.companyPhone}` : ''}
      </div>
    </div>
    <div class="doc-block">
      <div class="doc-title">${docTitle}</div>
      <div class="doc-original">${isCreditNote ? 'อ้างอิงใบเสร็จเดิม' : 'ต้นฉบับ'}</div>
      <div class="doc-meta">
        <span class="k">เลขที่เอกสาร</span><span class="v">${safe.receiptNumber}</span>
        <span class="k">วันที่ออกเอกสาร</span><span class="v">${paidDateStr}</span>
        ${safe.contractNumber ? `<span class="k">เลขที่สัญญา</span><span class="v">${safe.contractNumber}</span>` : ''}
        ${safe.branchName ? `<span class="k">สาขา</span><span class="v">${safe.branchName}</span>` : ''}
      </div>
    </div>
  </div>

  <!-- Parties -->
  <div class="parties">
    <div>
      <div class="party-heading">ลูกค้า / ผู้ชำระเงิน</div>
      <div class="party-name">${safe.payerName}</div>
      ${safe.payerAddress ? `<div class="party-line">${safe.payerAddress}</div>` : ''}
      ${safe.payerTaxId ? `<div class="party-line"><strong>เลขประจำตัวผู้เสียภาษี/บัตรประชาชน</strong> ${safe.payerTaxId}</div>` : ''}
      ${safe.customerPhone ? `<div class="party-line"><strong>โทร</strong> ${safe.customerPhone}</div>` : ''}
    </div>
    <div>
      <div class="party-heading">รายละเอียดสัญญา</div>
      ${safe.productName ? `<div class="party-name">${safe.productName}</div>` : `<div class="party-name">–</div>`}
      ${safe.imeiSerial ? `<div class="party-line"><strong>IMEI</strong> ${safe.imeiSerial}</div>` : (safe.serialNumber ? `<div class="party-line"><strong>S/N</strong> ${safe.serialNumber}</div>` : '')}
      ${receipt.installmentNo && receipt.contract?.totalMonths ? `<div class="party-line"><strong>งวดที่ชำระ</strong> ${receipt.installmentNo} จาก ${receipt.contract.totalMonths} งวด</div>` : ''}
    </div>
  </div>

  ${isCreditNote && receipt.voidedRef ? `
    <div class="cn-notice">
      เอกสารนี้ออกเพื่อยกเลิกใบเสร็จรับเงินเลขที่ <strong>${this.escapeHtml(receipt.voidedRef.receiptNumber)}</strong>
      ลงวันที่ ${formatDateShort(receipt.voidedRef.paidDate)} — ยอดตามใบเสร็จเดิมถูกกลับรายการทั้งจำนวน
    </div>` : ''}

  <!-- Items -->
  <table class="items">
    <thead>
      <tr>
        <th style="width:50%">รายการ</th>
        <th class="right">มูลค่าก่อนภาษี</th>
        <th class="right">ภาษีมูลค่าเพิ่ม 7%</th>
        <th class="right">จำนวนเงิน (บาท)</th>
      </tr>
    </thead>
    <tbody>
      ${installmentPortion.gt(0) || feePortion.lte(0) ? `
      <tr>
        <td>
          <div class="item-name">${itemLabel}</div>
          ${safe.productName && !isCreditNote ? `<div class="item-meta">${safe.productName}${safe.imeiSerial ? ` · IMEI ${safe.imeiSerial}` : ''}</div>` : ''}
        </td>
        <td class="right">${fmt(exclVat)}</td>
        <td class="right">${vatBearing && vatPart.gt(0) ? fmt(vatPart) : '<span class="vat-exempt">ยกเว้น</span>'}</td>
        <td class="right"><strong>${fmt(installmentPortion)}</strong></td>
      </tr>` : ''}
      ${feeCharged.gt(0) ? `
      <tr class="alt">
        <td>
          <div class="item-name">ค่าปรับชำระล่าช้า</div>
          <div class="item-meta">ไม่อยู่ในฐานภาษีมูลค่าเพิ่ม</div>
        </td>
        <td class="right">${fmt(feeCharged)}</td>
        <td class="right"><span class="vat-exempt">ยกเว้น</span></td>
        <td class="right"><strong>${fmt(feeCharged)}</strong></td>
      </tr>` : ''}
      ${feeWaived.gt(0) ? `
      <tr class="alt">
        <td>
          <div class="item-name discount">ส่วนลด/อนุโลมค่าปรับ</div>
          ${receipt.payment?.waivedReason ? `<div class="item-meta">${this.escapeHtml(receipt.payment.waivedReason)}</div>` : ''}
        </td>
        <td class="right discount">−${fmt(feeWaived)}</td>
        <td class="right"><span class="vat-exempt">–</span></td>
        <td class="right discount"><strong>−${fmt(feeWaived)}</strong></td>
      </tr>` : ''}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrap">
    <div>
      <div class="baht-text">
        <span class="label">จำนวนเงินตัวอักษร</span>
        <span class="value">( ${thaiAmount} )</span>
      </div>
      ${isPartial && totalDue !== null && totalPaidOnInstallment !== null ? `
        <div class="partial-tag">ชำระบางส่วน — สะสมงวดนี้ ${fmt(totalPaidOnInstallment)} จากยอดงวด ${fmt(totalDue)} บาท</div>` : ''}
    </div>
    <div class="totals">
      ${vatBearing && vatPart.gt(0) ? `
        <div class="row"><span class="k">มูลค่าสินค้า/บริการก่อนภาษี</span><span class="v">${fmt(exclVat)}</span></div>
        <div class="row"><span class="k">ภาษีมูลค่าเพิ่ม 7%</span><span class="v">${fmt(vatPart)}</span></div>
        ${feePortion.gt(0) ? `<div class="row sub"><span class="k">ค่าปรับ (ยกเว้นภาษี)</span><span class="v">${fmt(feePortion)}</span></div>` : `<div class="row sub" style="padding:0"></div>`}
      ` : ''}
      <div class="grand">
        <span class="k">${isCreditNote ? 'ยอดลดหนี้ทั้งสิ้น' : 'จำนวนเงินรับชำระทั้งสิ้น'}</span>
        <span class="v">${fmt(total)}<span class="suffix">บาท</span></span>
      </div>
    </div>
  </div>

  <!-- Payment details + balance -->
  <div class="pay-grid">
    <div class="pay-col">
      <div class="heading">การชำระเงิน</div>
      <div class="kv">
        <span class="k">วันที่ชำระ</span><span class="v">${paidDateStr}</span>
        <span class="k">ช่องทาง</span><span class="v">${safe.paymentMethodLabel || '–'}</span>
        ${safe.transactionRef ? `<span class="k">เลขอ้างอิง</span><span class="v">${safe.transactionRef}</span>` : ''}
        ${showBankAccount && safe.bankName ? `<span class="k">บัญชีรับเงิน</span><span class="v">${safe.bankName}${safe.bankAccountNumber ? ` ${safe.bankAccountNumber}` : ''}</span>` : ''}
      </div>
    </div>
    <div class="pay-col">
      <div class="heading">สถานะสัญญาหลังชำระ</div>
      <div class="kv">
        ${isCreditNote
          ? `<span class="k">สถานะ</span><span class="v">กลับรายการ — งวดนี้กลับเป็นยอดค้างชำระ</span>`
          : `
        ${remainingBalance.gt(0) ? `<span class="k">ยอดคงเหลือ</span><span class="v">${fmt(remainingBalance)} บาท</span>` : ''}
        ${receipt.remainingMonths ? `<span class="k">งวดคงเหลือ</span><span class="v">${receipt.remainingMonths} งวด</span>` : ''}
        ${!remainingBalance.gt(0) && !receipt.remainingMonths ? `<span class="k">สถานะ</span><span class="v">ชำระครบตามเอกสารนี้</span>` : ''}`}
      </div>
    </div>
  </div>

  <!-- Footer: verification + signature -->
  <div class="footer">
    <div class="qr-pane">
      <img src="${qrDataUrl}" alt="QR"/>
      <div class="qr-caption">สแกนเพื่อตรวจสอบความถูกต้องของเอกสาร</div>
    </div>
    <div></div>
    <div class="sig-block">
      <div class="sig-handwriting">${safe.issuerSignName}</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${safe.issuerName}</div>
      <div class="sig-role">ผู้รับเงิน / ผู้ออกเอกสาร</div>
      <div class="sig-date">${paidDateStr}</div>
    </div>
    <div class="doc-note">เอกสารนี้จัดทำโดยระบบคอมพิวเตอร์ของ ${safe.companyName} · เลขที่ ${safe.receiptNumber} · ตรวจสอบได้ที่ QR ด้านซ้าย</div>
  </div>
</body>
</html>`;

    // C5 fix (round 2): fonts are embedded as base64 @font-face data URIs.
    // No external network needed — domcontentloaded is sufficient.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();
    return Buffer.from(pdf);
  }
}
