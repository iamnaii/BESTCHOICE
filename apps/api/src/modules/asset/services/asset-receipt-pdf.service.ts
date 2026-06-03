import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';

// ──────────────────────────────────────────────────────────────────────────────
// Self-hosted fonts (mirrors expense-documents/services/expense-voucher-pdf.service.ts).
//
// The four IBM Plex Sans Thai weights + Sriracha TTFs were committed once to
// `src/modules/other-income/assets/fonts/` (OFL license). We embed them as
// base64 data: URIs at boot time (cached in module scope) so puppeteer can wait
// on `domcontentloaded` only — zero outbound network requests during render.
//
// The asset receipt reuses the EXACT same committed font files as the OI receipt
// and the expense voucher; no duplicate copy is added under asset/.
// ──────────────────────────────────────────────────────────────────────────────

const FONT_DIR_CANDIDATES = [
  // Dev: src/modules/other-income/assets/fonts/*.ttf (shared with OI receipt)
  path.join(__dirname, '..', '..', 'other-income', 'assets', 'fonts'),
  // Prod (nest build): dist/src/modules/other-income/assets/fonts/*.ttf
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'src',
    'modules',
    'other-income',
    'assets',
    'fonts',
  ),
  // Fallback when working directory matters
  path.join(process.cwd(), 'src', 'modules', 'other-income', 'assets', 'fonts'),
  path.join(
    process.cwd(),
    'apps',
    'api',
    'src',
    'modules',
    'other-income',
    'assets',
    'fonts',
  ),
];

interface FontDef {
  family: string;
  weight: number;
  file: string;
}

const FONT_FILES: FontDef[] = [
  { family: 'IBM Plex Sans Thai', weight: 400, file: 'ibmplexsansthai-400.ttf' },
  { family: 'IBM Plex Sans Thai', weight: 500, file: 'ibmplexsansthai-500.ttf' },
  { family: 'IBM Plex Sans Thai', weight: 600, file: 'ibmplexsansthai-600.ttf' },
  { family: 'IBM Plex Sans Thai', weight: 700, file: 'ibmplexsansthai-700.ttf' },
  { family: 'Sriracha', weight: 400, file: 'sriracha-400.ttf' },
];

let cachedFontCss: string | null = null;

/** Build the @font-face block once at first call, cache for the process lifetime. */
function getEmbeddedFontCss(logger: Logger): string {
  if (cachedFontCss !== null) return cachedFontCss;

  const fontsDir =
    FONT_DIR_CANDIDATES.find((dir) =>
      fs.existsSync(path.join(dir, FONT_FILES[0].file)),
    ) ?? FONT_DIR_CANDIDATES[0];

  const blocks: string[] = [];
  for (const f of FONT_FILES) {
    const full = path.join(fontsDir, f.file);
    try {
      const b64 = fs.readFileSync(full).toString('base64');
      blocks.push(
        `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;` +
          `src:url(data:font/ttf;base64,${b64}) format('truetype');}`,
      );
    } catch (err) {
      logger.warn(
        `Could not embed font ${f.file} (looked in ${fontsDir}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  cachedFontCss = blocks.join('\n');
  return cachedFontCss;
}

type AssetWithRelations = Prisma.FixedAssetGetPayload<{
  include: {
    branch: { select: { id: true; name: true } };
    createdBy: { select: { id: true; name: true; email: true } };
    postedBy: { select: { id: true; name: true } };
  };
}>;

const CATEGORY_LABEL_TH: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่ง',
  VEHICLE: 'ยานพาหนะ',
};

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  // Pin to Asia/Bangkok so server TZ (Cloud Run UTC) doesn't shift the date
  // by 1 day for late-evening BKK timestamps, and render year in Buddhist
  // Era (พ.ศ.) — Thai accounting documents use พ.ศ.
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
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
function numberToThaiText(num: number): string {
  if (!isFinite(num)) return '(จำนวนเงินไม่ถูกต้อง)';
  if (num < 0) return `ลบ${numberToThaiText(-num)}`;
  if (num === 0) return 'ศูนย์บาทถ้วน';
  // Cap at < 1e12 (999,999,999,999.99 baht) — extending readGroup beyond 6 digits
  // would mis-spell the ล้านล้าน group; very unlikely for an asset doc.
  if (num >= 1e12) return '(จำนวนเงินเกินขีดจำกัด)';
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
      if (place === 1 && d === 1) s += 'สิบ';
      else if (place === 1 && d === 2) s += 'ยี่สิบ';
      else if (place === 0 && d === 1 && len > 1) s += 'เอ็ด';
      else s += digits[d] + places[place];
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
  if (satang === 0) text += 'ถ้วน';
  else text += readGroup(satang) + 'สตางค์';
  return text;
}

// BESTCHOICE wordmark — reused from expense-voucher-pdf.service.ts.
const BESTCHOICE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="395 285 710 425" fill="none"><defs><linearGradient id="bc-as" gradientUnits="userSpaceOnUse" x1="597.6" y1="434.1" x2="902.4" y2="434.1"><stop offset="0" stop-color="#39F0CF"/><stop offset="0.5" stop-color="#25BC93"/><stop offset="1" stop-color="#1DA579"/></linearGradient></defs><path fill="url(#bc-as)" d="M 603.769531 297.347656 C 600.023438 298.191406 597.769531 301.1875 597.597656 305.820312 C 597.414062 310.808594 599.695312 314.0625 603.605469 315.121094 C 605.0625 315.515625 606.605469 315.484375 608.132812 315.453125 C 608.550781 315.445312 608.96875 315.4375 609.382812 315.4375 C 623.914062 315.445312 638.449219 315.445312 652.980469 315.445312 C 662.1875 315.445312 671.390625 315.445312 680.59375 315.445312 C 692.277344 315.449219 696.074219 321.558594 693.207031 335.660156 C 687.417969 364.132812 681.613281 392.601562 675.878906 421.089844 C 673.085938 434.941406 678.320312 443.273438 689.765625 443.289062 C 717.367188 443.324219 744.976562 443.292969 772.582031 443.335938 C 782.101562 443.351562 785.0625 447.972656 782.789062 459.183594 C 777.746094 484.074219 772.6875 508.957031 767.59375 533.832031 C 764.777344 547.605469 759.269531 552.824219 747.617188 552.828125 C 701.550781 552.84375 655.484375 552.839844 609.414062 552.847656 C 608.996094 552.847656 608.578125 552.84375 608.160156 552.835938 C 606.816406 552.820312 605.472656 552.800781 604.144531 552.976562 C 599.992188 553.523438 597.800781 556.847656 597.597656 561.664062 C 597.402344 566.289062 599.542969 569.574219 603.199219 570.730469 C 604.714844 571.210938 606.347656 571.191406 607.960938 571.171875 C 608.292969 571.164062 608.628906 571.160156 608.960938 571.160156 C 650.808594 571.183594 692.65625 571.175781 734.503906 571.179688 C 776.878906 571.183594 819.257812 571.214844 861.632812 571.164062 C 873.066406 571.152344 879.71875 564.628906 882.480469 551.023438 C 888.8125 519.808594 895.195312 488.605469 901.441406 457.363281 C 905.367188 437.703125 897.210938 424.992188 880.769531 424.957031 C 868.933594 424.933594 857.101562 424.9375 845.265625 424.941406 C 833.714844 424.945312 822.164062 424.949219 810.613281 424.925781 C 799.550781 424.90625 794.933594 417.503906 797.613281 404.195312 C 802.675781 379.085938 807.78125 353.988281 812.839844 328.878906 C 816.617188 310.132812 808.339844 297.125 792.601562 297.121094 C 731.234375 297.097656 669.867188 297.109375 608.503906 297.117188 C 607.859375 297.117188 607.214844 297.097656 606.566406 297.097656 C 605.625 297.097656 604.683594 297.140625 603.769531 297.347656"/><path fill="#4D4D4D" d="M 434.851562 645.261719 L 432.128906 658.890625 L 446.460938 658.890625 C 450.027344 658.890625 452.738281 658.199219 454.589844 656.820312 C 456.4375 655.441406 457.363281 653.441406 457.363281 650.816406 C 457.363281 647.117188 454.570312 645.261719 448.984375 645.261719 Z M 452.214844 684.933594 C 454.234375 683.523438 455.246094 681.4375 455.246094 678.675781 C 455.246094 676.65625 454.503906 675.160156 453.023438 674.183594 C 451.542969 673.207031 449.523438 672.71875 446.964844 672.71875 L 429.300781 672.71875 L 426.476562 687.054688 L 443.835938 687.054688 C 447.402344 687.054688 450.199219 686.347656 452.214844 684.933594 M 472.65625 670.652344 C 474.304688 673.039062 475.128906 675.851562 475.128906 679.078125 C 475.128906 686.414062 472.136719 691.984375 466.148438 695.785156 C 460.15625 699.589844 452.351562 701.488281 442.726562 701.488281 L 403.863281 701.488281 L 417.996094 630.828125 L 453.730469 630.828125 C 461.667969 630.828125 467.746094 632.257812 471.949219 635.117188 C 476.15625 637.980469 478.257812 642.066406 478.257812 647.382812 C 478.257812 651.488281 477.148438 655.039062 474.929688 658.03125 C 472.707031 661.027344 469.613281 663.367188 465.640625 665.046875 C 468.667969 666.394531 471.007812 668.261719 472.65625 670.652344"/><path fill="#4D4D4D" d="M 512.175781 646.273438 L 509.855469 658.183594 L 541.25 658.183594 L 538.320312 673.125 L 506.828125 673.125 L 504.304688 686.042969 L 541.351562 686.042969 L 538.121094 701.488281 L 481.488281 701.488281 L 495.621094 630.828125 L 550.941406 630.828125 L 547.808594 646.273438 Z"/><path fill="#4D4D4D" d="M 559.015625 700.78125 C 553.765625 699.371094 549.492188 697.554688 546.195312 695.332031 L 554.070312 680.390625 C 557.632812 682.679688 561.4375 684.414062 565.472656 685.589844 C 569.511719 686.769531 573.550781 687.355469 577.589844 687.355469 C 581.425781 687.355469 584.402344 686.800781 586.523438 685.691406 C 588.640625 684.582031 589.703125 683.050781 589.703125 681.097656 C 589.703125 679.417969 588.742188 678.105469 586.824219 677.164062 C 584.90625 676.21875 581.929688 675.210938 577.890625 674.132812 C 573.3125 672.921875 569.511719 671.695312 566.484375 670.449219 C 563.457031 669.203125 560.847656 667.304688 558.660156 664.746094 C 556.472656 662.1875 555.378906 658.824219 555.378906 654.652344 C 555.378906 649.601562 556.757812 645.179688 559.519531 641.378906 C 562.277344 637.574219 566.214844 634.632812 571.328125 632.542969 C 576.445312 630.460938 582.433594 629.414062 589.296875 629.414062 C 594.34375 629.414062 599.054688 629.9375 603.429688 630.980469 C 607.804688 632.023438 611.574219 633.519531 614.738281 635.472656 L 607.46875 650.308594 C 604.707031 648.5625 601.664062 647.230469 598.332031 646.324219 C 595.003906 645.414062 591.585938 644.960938 588.085938 644.960938 C 584.117188 644.960938 581.003906 645.601562 578.75 646.878906 C 576.492188 648.15625 575.367188 649.804688 575.367188 651.824219 C 575.367188 653.574219 576.34375 654.921875 578.296875 655.863281 C 580.246094 656.804688 583.273438 657.816406 587.378906 658.890625 C 591.957031 660.035156 595.742188 661.210938 598.738281 662.425781 C 601.730469 663.636719 604.304688 665.484375 606.460938 667.976562 C 608.613281 670.464844 609.6875 673.730469 609.6875 677.765625 C 609.6875 682.75 608.292969 687.140625 605.5 690.941406 C 602.707031 694.742188 598.738281 697.6875 593.589844 699.773438 C 588.441406 701.859375 582.464844 702.902344 575.671875 702.902344 C 569.816406 702.902344 564.261719 702.195312 559.015625 700.78125"/><path fill="#4D4D4D" d="M 639.566406 646.675781 L 617.863281 646.675781 L 621.09375 630.828125 L 684.386719 630.828125 L 681.15625 646.675781 L 659.554688 646.675781 L 648.550781 701.488281 L 628.566406 701.488281 Z"/><path fill="#1DA579" d="M 717.195312 686.347656 C 711.878906 686.347656 707.671875 684.902344 704.574219 682.007812 C 701.480469 679.113281 699.933594 675.277344 699.933594 670.5 C 699.933594 665.855469 700.890625 661.667969 702.808594 657.933594 C 704.726562 654.195312 707.402344 651.269531 710.835938 649.148438 C 714.265625 647.03125 718.238281 645.96875 722.746094 645.96875 C 729.675781 645.96875 734.859375 648.730469 738.292969 654.246094 L 752.726562 642.738281 C 750.234375 638.5 746.46875 635.21875 741.421875 632.898438 C 736.375 630.578125 730.585938 629.414062 724.058594 629.414062 C 715.441406 629.414062 707.769531 631.230469 701.042969 634.867188 C 694.3125 638.5 689.082031 643.546875 685.347656 650.007812 C 681.609375 656.46875 679.742188 663.738281 679.742188 671.8125 C 679.742188 677.9375 681.191406 683.355469 684.085938 688.0625 C 686.976562 692.777344 691.117188 696.425781 696.5 699.015625 C 701.882812 701.605469 708.140625 702.902344 715.277344 702.902344 C 721.871094 702.902344 727.726562 701.875 732.839844 699.824219 C 737.953125 697.773438 742.429688 694.421875 746.265625 689.78125 L 734.457031 678.171875 C 729.675781 683.621094 723.921875 686.347656 717.195312 686.347656"/><path fill="#1DA579" d="M 807.234375 657.277344 L 780.082031 657.277344 L 785.332031 630.828125 L 765.34375 630.828125 L 751.210938 701.488281 L 771.199219 701.488281 L 776.648438 674.03125 L 803.804688 674.03125 L 798.351562 701.488281 L 818.339844 701.488281 L 832.472656 630.828125 L 812.484375 630.828125 Z"/><path fill="#1DA579" d="M 891.929688 674.082031 C 890.109375 677.816406 887.519531 680.796875 884.15625 683.015625 C 880.789062 685.238281 876.886719 686.347656 872.445312 686.347656 C 867.195312 686.347656 863.109375 684.917969 860.179688 682.058594 C 857.253906 679.199219 855.789062 675.378906 855.789062 670.601562 C 855.789062 666.09375 856.699219 661.96875 858.515625 658.234375 C 860.332031 654.5 862.921875 651.519531 866.289062 649.300781 C 869.652344 647.078125 873.554688 645.96875 877.996094 645.96875 C 883.246094 645.96875 887.335938 647.398438 890.261719 650.261719 C 893.191406 653.121094 894.652344 656.9375 894.652344 661.71875 C 894.652344 666.226562 893.746094 670.347656 891.929688 674.082031 M 898.339844 633.351562 C 893.054688 630.726562 886.847656 629.414062 879.714844 629.414062 C 871.167969 629.414062 863.546875 631.230469 856.851562 634.867188 C 850.152344 638.5 844.9375 643.546875 841.203125 650.007812 C 837.46875 656.46875 835.601562 663.734375 835.601562 671.8125 C 835.601562 677.867188 837.03125 683.253906 839.890625 687.964844 C 842.75 692.675781 846.820312 696.339844 852.105469 698.964844 C 857.386719 701.589844 863.597656 702.902344 870.730469 702.902344 C 879.273438 702.902344 886.898438 701.085938 893.59375 697.449219 C 900.289062 693.816406 905.503906 688.769531 909.238281 682.308594 C 912.976562 675.851562 914.84375 668.582031 914.84375 660.507812 C 914.84375 654.449219 913.410156 649.066406 910.550781 644.355469 C 907.691406 639.644531 903.621094 635.976562 898.339844 633.351562"/><path fill="#1DA579" d="M 917.972656 701.488281 L 937.957031 701.488281 L 952.089844 630.828125 L 932.101562 630.828125 Z"/><path fill="#1DA579" d="M 992.667969 686.347656 C 987.351562 686.347656 983.144531 684.902344 980.050781 682.007812 C 976.957031 679.113281 975.40625 675.277344 975.40625 670.5 C 975.40625 665.855469 976.367188 661.667969 978.285156 657.933594 C 980.203125 654.195312 982.878906 651.269531 986.308594 649.148438 C 989.742188 647.03125 993.710938 645.96875 998.222656 645.96875 C 1005.152344 645.96875 1010.335938 648.730469 1013.765625 654.246094 L 1028.203125 642.738281 C 1025.710938 638.5 1021.945312 635.21875 1016.894531 632.898438 C 1011.847656 630.578125 1006.058594 629.414062 999.535156 629.414062 C 990.917969 629.414062 983.246094 631.230469 976.519531 634.867188 C 969.789062 638.5 964.554688 643.546875 960.820312 650.007812 C 957.085938 656.46875 955.21875 663.738281 955.21875 671.8125 C 955.21875 677.9375 956.664062 683.355469 959.558594 688.0625 C 962.453125 692.777344 966.589844 696.425781 971.976562 699.015625 C 977.359375 701.605469 983.617188 702.902344 990.75 702.902344 C 997.347656 702.902344 1003.199219 701.875 1008.316406 699.824219 C 1013.429688 697.773438 1017.90625 694.421875 1021.742188 689.78125 L 1009.929688 678.171875 C 1005.152344 683.621094 999.398438 686.347656 992.667969 686.347656"/><path fill="#1DA579" d="M 1093.007812 646.273438 L 1096.136719 630.828125 L 1040.820312 630.828125 L 1026.6875 701.488281 L 1083.316406 701.488281 L 1086.546875 686.042969 L 1049.5 686.042969 L 1052.023438 673.125 L 1083.519531 673.125 L 1086.445312 658.183594 L 1055.050781 658.183594 L 1057.375 646.273438 Z"/></svg>`;

@Injectable()
export class AssetReceiptPdfService {
  private readonly logger = new Logger(AssetReceiptPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(id: string): Promise<Buffer> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        postedBy: { select: { id: true, name: true } },
      },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    // Only POSTED/REVERSED assets carry a journal entry. The asset goods-receipt
    // voucher certifies a capitalized acquisition recorded in the books —
    // printing one for a DRAFT/DISPOSED/WRITTEN_OFF asset would attest to a
    // recording that hasn't happened (or no longer reflects the acquisition).
    if (asset.status !== 'POSTED' && asset.status !== 'REVERSED') {
      throw new BadRequestException(
        'สินทรัพย์ยังไม่ได้ลงบัญชี ไม่สามารถออกใบรับสินทรัพย์ได้',
      );
    }

    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE' },
    });
    if (!company) {
      // Render still succeeds via the hardcoded fallback name, but a missing
      // FINANCE CompanyInfo means every receipt mislabels the company — surface
      // it so ops can fix the config instead of it failing silently.
      this.logger.warn(
        'CompanyInfo (companyCode=FINANCE) not found — asset receipt PDF will use the fallback company name',
      );
    }

    const html = await this.renderHtml(asset, company);

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      // Fonts are self-hosted (base64 data: URIs embedded in the HTML) so there
      // are zero outbound network requests — wait only for the HTML to parse.
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 10_000,
      });
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
    asset: AssetWithRelations,
    company:
      | {
          nameTh: string;
          taxId: string | null;
          address: string | null;
          phone: string | null;
        }
      | null,
  ): Promise<string> {
    const verifyUrl = `https://bestchoicephone.app/assets/${asset.id}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 260,
      color: { dark: '#18181b', light: '#ffffff' },
    });

    const safe = {
      companyName:
        escapeHtml(company?.nameTh) || 'บริษัท เบสท์ช้อยส์ ไฟแนนท์ จำกัด',
      companyAddress: escapeHtml(formatAddress(company?.address)),
      companyPhone: escapeHtml(company?.phone),
      taxId: escapeHtml(company?.taxId),
      supplierName: escapeHtml(asset.supplierName || '—'),
      supplierTaxId: escapeHtml(asset.supplierTaxId),
      assetCode: escapeHtml(asset.assetCode),
      docNo: escapeHtml(asset.docNo),
      assetName: escapeHtml(asset.name),
      categoryLabel: escapeHtml(CATEGORY_LABEL_TH[asset.category] || asset.category),
      purchaseDateStr: fmtDateShort(asset.purchaseDate),
      branchName: escapeHtml(asset.branch?.name),
      taxInvoiceNo: escapeHtml(asset.taxInvoiceNo),
      note: escapeHtml(asset.note),
      preparerName: escapeHtml(asset.createdBy?.name) || 'ระบบ',
      preparerSignName:
        escapeHtml((asset.createdBy?.name || '').split(/\s+/)[0]) || 'ระบบ',
      preparerEmail: escapeHtml(asset.createdBy?.email),
      approverName: escapeHtml(asset.postedBy?.name),
    };

    const basePrice = Number(asset.basePrice);
    const shippingCost = Number(asset.shippingCost);
    const installationCost = Number(asset.installationCost);
    const otherCapitalized = Number(asset.otherCapitalized);
    const vatAmount = Number(asset.vatAmount);
    const purchaseCost = Number(asset.purchaseCost);
    const usefulLifeMonths = asset.usefulLifeMonths;
    const hasVat = asset.hasVat;
    // Grand total certified on the receipt = capitalized cost (purchaseCost,
    // persisted at POST). VAT is shown for reference only — it is not part of
    // the capitalized base (purchaseCost = basePrice + ship + install + other).
    const thaiAmount = numberToThaiText(purchaseCost);
    const isReversed = asset.status === 'REVERSED';

    const embeddedFontCss = getEmbeddedFontCss(this.logger);

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
    /* Self-hosted fonts — no fonts.googleapis.com requests */
    ${embeddedFontCss}
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --emerald-50:#ecfdf5; --emerald-100:#d1fae5; --emerald-700:#047857; --emerald-800:#065f46;
      --zinc-200:#e4e4e7; --zinc-300:#d4d4d8; --zinc-400:#a1a1aa; --zinc-500:#71717a; --zinc-600:#52525b; --zinc-700:#3f3f46; --zinc-900:#18181b;
      --red-500:#ef4444; --red-600:#dc2626;
    }
    body { font-family: 'IBM Plex Sans Thai', system-ui, -apple-system, sans-serif; color: var(--zinc-900); font-size: 9.5pt; line-height: 1.45; padding: 11mm 12mm 10mm; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; border-bottom:1.5px solid var(--zinc-300); }
    .logo-block svg { height: 32px; width: auto; }
    .doc-title { font-size:20pt; font-weight:700; color:var(--emerald-700); line-height:1; text-align:right; letter-spacing:-0.01em; }
    .doc-title .en { display:block; font-size:9pt; font-weight:600; color:var(--zinc-500); margin-top:3px; letter-spacing:0.04em; }

    .parties { display:grid; grid-template-columns: minmax(0, 1fr) 220px; gap:14px; padding:12px 0; border-bottom:1px solid var(--zinc-200); margin-bottom:12px; }
    .party-row { display:grid; grid-template-columns: 86px 1fr; gap:6px; margin-bottom:4px; align-items:start; font-size:9.5pt; }
    .party-label { color:var(--zinc-900); font-weight:700; white-space:nowrap; }
    .party-name { font-weight:600; }
    .party-divider { margin:10px 0; border:0; border-top:1px solid var(--zinc-200); }
    .meta-card { background:var(--emerald-50); border:1px solid var(--emerald-100); border-radius:6px; padding:10px 14px; font-size:9pt; align-self:start; }
    .meta-row { display:flex; justify-content:space-between; padding:3px 0; gap:8px; }
    .meta-label { color:var(--emerald-800); font-weight:600; white-space:nowrap; }
    .meta-value { color:var(--zinc-900); font-family:'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size:8.5pt; font-weight:500; text-align:right; word-break:break-all; }

    .details-section { padding:0 0 12px; margin-bottom:12px; border-bottom:1px solid var(--zinc-200); }
    .details-grid { display:grid; grid-template-columns:max-content 1fr; column-gap:18px; row-gap:5px; font-size:9.5pt; margin-top:4px; }
    .details-grid .dlabel { color:var(--zinc-700); font-weight:600; white-space:nowrap; }
    .details-grid .dval { color:var(--zinc-900); }

    table.items { width:100%; border-collapse:collapse; font-size:9pt; }
    table.items thead th { text-align:left; padding:6px 8px; background:var(--emerald-50); color:var(--emerald-800); font-size:8.5pt; font-weight:600; border-bottom:1.5px solid var(--emerald-700); }
    table.items thead th.right { text-align:right; }
    table.items tbody td { padding:8px; border-bottom:1px solid var(--zinc-200); vertical-align:top; font-variant-numeric:tabular-nums; }
    table.items tbody td.right { text-align:right; }
    table.items td.no { color:var(--zinc-500); width:22px; }
    .item-name { font-weight:600; }

    .summary { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:12px 0; margin-bottom:12px; border-bottom:1px solid var(--zinc-200); }
    .summary-section { display:grid; grid-template-columns:18px 1fr; gap:8px; align-items:start; }
    .summary-section .icon { width:16px; height:16px; color:var(--zinc-700); margin-top:2px; }
    .breakdown { display:grid; grid-template-columns:max-content 1fr auto; column-gap:18px; row-gap:4px; font-size:9.5pt; }
    .breakdown .label { color:var(--zinc-700); }
    .breakdown .label.bold { font-weight:600; color:var(--zinc-900); }
    .breakdown .text { color:var(--zinc-600); font-style:italic; font-size:9pt; }
    .breakdown .num { text-align:right; font-variant-numeric:tabular-nums; color:var(--zinc-900); }
    .grand-card { background:var(--emerald-50); border-radius:8px; padding:10px 14px; text-align:center; }
    .grand-card .label { color:var(--emerald-800); font-size:9pt; font-weight:600; margin-bottom:3px; }
    .grand-card .amount { color:var(--emerald-700); font-size:18pt; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
    .grand-card .amount-suffix { color:var(--emerald-700); font-size:11pt; font-weight:500; margin-left:4px; }
    .summary-aux { margin-top:10px; display:grid; grid-template-columns:1fr auto; row-gap:4px; column-gap:18px; font-size:9.5pt; }
    .summary-aux .label { color:var(--zinc-700); }
    .summary-aux .num { text-align:right; font-variant-numeric:tabular-nums; }

    .notes-section { padding-bottom:10px; margin-bottom:12px; font-size:9pt; border-bottom:1px solid var(--zinc-200); }
    .sec-title { display:flex; align-items:center; gap:8px; font-size:10pt; font-weight:700; color:var(--zinc-900); margin-bottom:6px; }
    .sec-title .icon-pill { width:22px; height:22px; background:var(--zinc-900); color:#fff; border-radius:6px; display:flex; align-items:center; justify-content:center; }
    .sec-title .icon-pill svg { width:13px; height:13px; }
    .notes-section .body { color:var(--zinc-600); min-height:10px; }

    .approval { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; align-items:start; margin-top:8px; page-break-inside:avoid; break-inside:avoid; }
    .qr-pane { text-align:center; }
    .qr-caption-top { font-size:9pt; color:var(--zinc-700); margin-bottom:5px; }
    .qr-pane img { width:104px; height:104px; }
    .sig-block { text-align:left; }
    .sig-role { font-size:9.5pt; color:var(--zinc-900); font-weight:600; margin-bottom:2px; }
    .sig-handwriting { font-family:'Sriracha', 'Apple Chancery', 'Brush Script MT', cursive; font-size:20pt; color:var(--zinc-600); line-height:1; transform:rotate(-3deg); transform-origin:left center; display:inline-block; opacity:0.85; margin-top:4px; min-height:24px; }
    .sig-rule { width:180px; border-top:1px dotted var(--zinc-300); margin:14px 0 5px; }
    .sig-name { font-size:10pt; font-weight:700; color:var(--zinc-900); }
    .sig-date { font-size:9pt; color:var(--zinc-500); margin-top:1px; font-variant-numeric:tabular-nums; }

    .void-badge { display:inline-block; margin:10px 0 0; padding:4px 12px; border:1.5px solid var(--red-600); border-radius:6px; color:var(--red-600); font-weight:700; font-size:10pt; letter-spacing:0.02em; }
    .void-overlay { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-15deg); font-size:70pt; font-weight:900; color:rgba(220,38,38,0.16); letter-spacing:0.08em; pointer-events:none; text-align:center; }
  </style>
</head>
<body>
  ${isReversed ? `<div class="void-overlay">กลับรายการแล้ว</div>` : ''}

  <!-- Header: Logo + Title -->
  <div class="header">
    <div class="logo-block">${BESTCHOICE_LOGO_SVG}</div>
    <div class="doc-title">ใบรับสินทรัพย์<span class="en">ASSET GOODS RECEIPT</span></div>
  </div>

  ${isReversed ? `<div class="void-badge">กลับรายการแล้ว</div>` : ''}

  <!-- Parties + meta -->
  <div class="parties">
    <div>
      <div class="party-row"><span class="party-label">ผู้รับสินทรัพย์ :</span><span class="party-name">${safe.companyName}</span></div>
      ${safe.companyAddress ? `<div class="party-row"><span class="party-label">ที่อยู่ :</span><span>${safe.companyAddress}</span></div>` : ''}
      ${safe.taxId ? `<div class="party-row"><span class="party-label">เลขที่ภาษี :</span><span>${safe.taxId}</span></div>` : ''}

      <hr class="party-divider"/>

      <div class="party-row"><span class="party-label">ผู้ขาย/ผู้ส่งมอบ :</span><span class="party-name">${safe.supplierName}</span></div>
      ${safe.supplierTaxId ? `<div class="party-row"><span class="party-label">เลขที่ภาษี :</span><span>${safe.supplierTaxId}</span></div>` : ''}
      ${safe.branchName ? `<div class="party-row"><span class="party-label">สาขา/สถานที่ :</span><span>${safe.branchName}</span></div>` : ''}
    </div>
    <div>
      <div class="meta-card">
        <div class="meta-row"><span class="meta-label">รหัสสินทรัพย์ :</span><span class="meta-value">${safe.assetCode}</span></div>
        <div class="meta-row"><span class="meta-label">เลขที่เอกสาร :</span><span class="meta-value">${safe.docNo}</span></div>
        <div class="meta-row"><span class="meta-label">วันที่รับสินทรัพย์ :</span><span class="meta-value">${safe.purchaseDateStr}</span></div>
        ${safe.taxInvoiceNo ? `<div class="meta-row"><span class="meta-label">เลขใบกำกับ :</span><span class="meta-value">${safe.taxInvoiceNo}</span></div>` : ''}
      </div>
    </div>
  </div>

  <!-- Asset details -->
  <div class="details-section">
    <div class="sec-title">
      <span class="icon-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9M14 17H5M17 17a3 3 0 1 0 6 0 3 3 0 0 0-6 0M7 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0"/></svg></span>
      <span>รายละเอียดสินทรัพย์</span>
    </div>
    <div class="details-grid">
      <span class="dlabel">ชื่อสินทรัพย์</span><span class="dval">${safe.assetName}</span>
      <span class="dlabel">หมวดสินทรัพย์</span><span class="dval">${safe.categoryLabel}</span>
      <span class="dlabel">อายุการใช้งาน</span><span class="dval">${usefulLifeMonths} เดือน</span>
    </div>
  </div>

  <!-- Cost breakdown table -->
  <table class="items">
    <thead>
      <tr>
        <th></th>
        <th>รายการต้นทุน</th>
        <th class="right">จำนวนเงิน</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="no">1.</td>
        <td><span class="item-name">ราคาทุน (มูลค่าซื้อ)</span></td>
        <td class="right">${fmtMoney(basePrice)}</td>
      </tr>
      ${shippingCost > 0 ? `<tr><td class="no">2.</td><td><span class="item-name">ค่าขนส่ง</span></td><td class="right">${fmtMoney(shippingCost)}</td></tr>` : ''}
      ${installationCost > 0 ? `<tr><td class="no">3.</td><td><span class="item-name">ค่าติดตั้ง</span></td><td class="right">${fmtMoney(installationCost)}</td></tr>` : ''}
      ${otherCapitalized > 0 ? `<tr><td class="no">4.</td><td><span class="item-name">ค่าใช้จ่ายอื่นๆ ที่รวมเป็นต้นทุน</span></td><td class="right">${fmtMoney(otherCapitalized)}</td></tr>` : ''}
    </tbody>
  </table>

  <!-- Summary -->
  <div class="summary">
    <div>
      <div class="summary-section">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        <div>
          <div style="font-weight:700; margin-bottom:4px;">สรุป</div>
          <div class="breakdown">
            <span class="label">ราคาทุน</span><span></span><span class="num">${fmtMoney(basePrice)} บาท</span>
            ${shippingCost > 0 ? `<span class="label">ค่าขนส่ง</span><span></span><span class="num">${fmtMoney(shippingCost)} บาท</span>` : ''}
            ${installationCost > 0 ? `<span class="label">ค่าติดตั้ง</span><span></span><span class="num">${fmtMoney(installationCost)} บาท</span>` : ''}
            ${otherCapitalized > 0 ? `<span class="label">ค่าใช้จ่ายอื่นๆ</span><span></span><span class="num">${fmtMoney(otherCapitalized)} บาท</span>` : ''}
            ${hasVat ? `<span class="label">ภาษีมูลค่าเพิ่ม 7%</span><span></span><span class="num">${fmtMoney(vatAmount)} บาท</span>` : ''}
            <span class="label bold">มูลค่าต้นทุนรวม</span>
            <span class="text">${thaiAmount}</span>
            <span></span>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div class="grand-card">
        <div class="label">มูลค่าต้นทุนรวม</div>
        <div class="amount">${fmtMoney(purchaseCost)}<span class="amount-suffix">บาท</span></div>
      </div>
      <div class="summary-aux">
        <span class="label">มูลค่าต้นทุนที่บันทึกเป็นสินทรัพย์</span><span class="num">${fmtMoney(purchaseCost)} บาท</span>
        ${hasVat ? `<span class="label">ภาษีมูลค่าเพิ่ม 7%</span><span class="num">${fmtMoney(vatAmount)} บาท</span>` : ''}
      </div>
    </div>
  </div>

  <!-- Notes -->
  <div class="notes-section">
    <div class="sec-title">
      <span class="icon-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
      <span>หมายเหตุ</span>
    </div>
    <div class="body">${safe.note || '&nbsp;'}</div>
  </div>

  <!-- Signatures (3-col): ผู้จัดทำ | ผู้ตรวจรับ/ผู้อนุมัติ | ผู้ส่งมอบ -->
  <div class="approval">
    <div class="sig-block">
      <div class="sig-role">ผู้จัดทำ</div>
      <div class="sig-handwriting">${safe.preparerSignName}</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${safe.preparerName}</div>
      <div class="sig-date">${safe.purchaseDateStr}</div>
    </div>
    <div class="sig-block">
      <div class="sig-role">ผู้ตรวจรับ/ผู้อนุมัติ</div>
      <div class="sig-handwriting">${safe.approverName ? escapeHtml((asset.postedBy?.name || '').split(/\s+/)[0]) : '&nbsp;'}</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${safe.approverName || '&nbsp;'}</div>
      <div class="sig-date">${safe.approverName ? safe.purchaseDateStr : '&nbsp;'}</div>
    </div>
    <div class="sig-block">
      <div class="sig-role">ผู้ส่งมอบ</div>
      <div class="sig-handwriting">&nbsp;</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${safe.supplierName}</div>
      <div class="sig-date">${safe.purchaseDateStr}</div>
    </div>
  </div>

  <!-- QR verify -->
  <div class="qr-pane" style="margin-top:14px;">
    <div class="qr-caption-top">สแกนเพื่อตรวจสอบเอกสาร</div>
    <img src="${qrDataUrl}" alt="QR"/>
  </div>
</body>
</html>`;
  }
}
