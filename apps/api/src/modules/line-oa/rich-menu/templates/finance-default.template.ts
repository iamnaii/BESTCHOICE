import { build2x3Areas, buildRichMenuHtml } from './base-html';
import { loadIcon } from './icons';
import { RichMenuTemplate, TemplateContext } from './types';

/**
 * FINANCE Default (Pre-Verify) rich menu.
 * Audience: LINE users who have added the OA but not yet linked their phone.
 * Goal: drive verification; avoid actions that require contract data.
 */
export function buildFinanceDefaultTemplate(ctx: TemplateContext): RichMenuTemplate {
  if (!ctx.liffId) {
    throw new Error('liffId is required to build finance default template');
  }

  const liffBase = `https://liff.line.me/${ctx.liffId}`;

  const html = buildRichMenuHtml({
    cells: [
      { iconSvg: loadIcon('key-round'), label: 'ผูกเบอร์เริ่มใช้งาน', hero: true },
      { iconSvg: loadIcon('credit-card'), label: 'วิธีชำระค่างวด' },
      { iconSvg: loadIcon('book-open'), label: 'วิธีใช้งาน' },
      { iconSvg: loadIcon('headset'), label: 'ติดต่อเจ้าหน้าที่' },
      { iconSvg: loadIcon('circle-help'), label: 'คำถามที่พบบ่อย' },
      { iconSvg: loadIcon('refresh-cw'), label: 'เปลี่ยนเบอร์' },
    ],
  });

  const areas = build2x3Areas([
    { type: 'uri', label: 'ผูกเบอร์', uri: `${liffBase}/finance-verify` },
    { type: 'message', label: 'วิธีชำระ', text: 'วิธีชำระ' },
    { type: 'message', label: 'วิธีใช้งาน', text: 'วิธีใช้งาน' },
    { type: 'message', label: 'ติดต่อ', text: 'ติดต่อเจ้าหน้าที่' },
    { type: 'message', label: 'FAQ', text: 'FAQ' },
    { type: 'message', label: 'เปลี่ยนเบอร์', text: 'เปลี่ยนเบอร์' },
  ]);

  return {
    name: 'BESTCHOICE FINANCE — Default (Pre-Verify)',
    chatBarText: 'เมนูน้องเบส',
    size: { width: 2500, height: 1686 },
    html,
    areas,
  };
}
