export type FlexMode = 'template' | 'json';

export type FlexTemplateKey = 'product' | 'promotion' | 'custom';

export interface FlexContent {
  flexMode: FlexMode;
  templateKey: FlexTemplateKey;
  fields: Record<string, string>;
  jsonText: string;
  jsonValid: boolean;
}

export const FLEX_TEMPLATES: Record<FlexTemplateKey, { name: string; fields: string[] }> = {
  product: {
    name: '📱 สินค้า',
    fields: ['ชื่อสินค้า', 'ราคา', 'รายละเอียด', 'รูปภาพ URL', 'ลิงก์'],
  },
  promotion: {
    name: '🎁 โปรโมชัน',
    fields: ['ชื่อโปร', 'รายละเอียด', 'ส่วนลด', 'วันหมดอายุ', 'ลิงก์'],
  },
  custom: {
    name: '✏️ กำหนดเอง',
    fields: ['หัวข้อ', 'เนื้อหา', 'ปุ่มกด', 'ลิงก์'],
  },
};

export function buildFlexJson(content: FlexContent): object {
  const { templateKey, fields } = content;
  const tpl = FLEX_TEMPLATES[templateKey];
  const title = fields[tpl.fields[0]] || tpl.name;
  const body = fields[tpl.fields[1]] || '';
  return {
    type: 'bubble',
    hero:
      templateKey === 'product' && fields['รูปภาพ URL']
        ? {
            type: 'image',
            url: fields['รูปภาพ URL'],
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
          }
        : undefined,
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        ...(body ? [{ type: 'text', text: body, size: 'sm', color: '#555555', wrap: true }] : []),
        ...(templateKey === 'promotion' && fields['ส่วนลด']
          ? [
              {
                type: 'text',
                text: `ลด ${fields['ส่วนลด']}`,
                size: 'xl',
                weight: 'bold',
                color: '#e74c3c',
              },
            ]
          : []),
      ].filter(Boolean),
    },
    footer: fields[tpl.fields[tpl.fields.length - 1]]
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'uri',
                label: templateKey === 'custom' ? fields['ปุ่มกด'] || 'ดูเพิ่มเติม' : 'ดูเพิ่มเติม',
                uri: fields[tpl.fields[tpl.fields.length - 1]],
              },
            },
          ],
        }
      : undefined,
  };
}
