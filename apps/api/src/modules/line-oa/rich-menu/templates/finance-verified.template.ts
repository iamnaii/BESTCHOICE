import { build2x3Areas, buildRichMenuHtml } from './base-html';
import { loadIcon } from './icons';
import { RichMenuTemplate, TemplateContext } from './types';

/**
 * FINANCE Verified rich menu.
 * Audience: customers who have linked their phone — system knows their
 * contracts and can show balance, schedule, history.
 */
export function buildFinanceVerifiedTemplate(ctx: TemplateContext): RichMenuTemplate {
  if (!ctx.liffId) {
    throw new Error('liffId is required to build finance verified template');
  }
  if (!ctx.callCenterPhone) {
    throw new Error('callCenterPhone is required to build finance verified template');
  }

  const liffBase = `https://liff.line.me/${ctx.liffId}`;
  const telUri = `tel:${ctx.callCenterPhone.replace(/[^\d+]/g, '')}`;

  const html = buildRichMenuHtml({
    // Slightly deeper mint tint signals "activated" state vs Default.
    bgGradient: { from: '#ECFDF5', to: '#FFFFFF' },
    cells: [
      { iconSvg: loadIcon('wallet'), label: 'เช็คยอด', hero: true },
      { iconSvg: loadIcon('calendar-days'), label: 'ดูตารางงวด' },
      { iconSvg: loadIcon('credit-card'), label: 'ชำระเงิน', urgent: true },
      { iconSvg: loadIcon('receipt'), label: 'ประวัติชำระ' },
      { iconSvg: loadIcon('file-text'), label: 'เช็คสัญญา' },
      { iconSvg: loadIcon('phone'), label: 'โทรหาเจ้าหน้าที่' },
    ],
  });

  const areas = build2x3Areas([
    { type: 'message', label: 'เช็คยอด', text: 'เช็คยอด' },
    { type: 'message', label: 'ตารางงวด', text: 'ดูตารางงวด' },
    { type: 'message', label: 'ชำระเงิน', text: 'ชำระเงิน' },
    { type: 'uri', label: 'ประวัติ', uri: `${liffBase}/history` },
    { type: 'uri', label: 'สัญญา', uri: `${liffBase}/contract` },
    { type: 'uri', label: 'โทร', uri: telUri },
  ]);

  return {
    name: 'BESTCHOICE FINANCE — Verified',
    chatBarText: 'เมนูน้องเบส',
    size: { width: 2500, height: 1686 },
    html,
    areas,
  };
}
