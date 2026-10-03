import {
  buildAfterSalesDocHtml,
  DOC_NOT_RECEIPT,
  escapeHtml,
  type AfterSalesDoc,
} from '../documents/after-sales-doc-html';
import { AFTER_SALES_LOGO_SVG } from '../documents/after-sales-logo';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function doc(over: Partial<AfterSalesDoc> = {}): AfterSalesDoc {
  return {
    title: 'ใบรับฝากเครื่อง',
    kicker: 'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
    company: {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address: 'ลพบุรี 15000',
      taxId: '0165568000050',
      phone: '063-134-6356',
    },
    meta: [
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'สาขา', value: 'ลพบุรี' },
    ],
    blocks: [],
    ack: 'ข้าพเจ้าฝากเครื่องตามรายการข้างต้นไว้กับร้าน',
    signatures: [
      { role: 'ลูกค้า (ผู้ฝาก)', name: 'สมชาย ใจดี', sub: 'วันที่ ........ / ........ / ........' },
      { role: 'พนักงาน', name: 'สุดา', sub: 'ลพบุรี · 7 ก.ย. 2569' },
    ],
    footer: 'หลังการขาย · เคส AS-20260907-0004',
    ...over,
  };
}

describe('buildAfterSalesDocHtml', () => {
  it('หัวเอกสาร: โลโก้ + บริษัท + ชื่อเอกสาร + kicker + meta + ลายเซ็น 2 ช่อง + บรรทัดไม่ใช่ใบเสร็จ', () => {
    const html = buildAfterSalesDocHtml(doc());
    for (const text of [
      'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      'เลขประจำตัวผู้เสียภาษี 0165568000050',
      'โทร 063-134-6356',
      '<h1>ใบรับฝากเครื่อง</h1>',
      'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
      'AS-20260907-0004',
      'ลูกค้า (ผู้ฝาก) — ( สมชาย ใจดี )',
      'พนักงาน — ( สุดา )',
      DOC_NOT_RECEIPT,
      'bc-as-doc',
    ])
      expect(html).toContain(text);
    expect(html.match(/class="bc-doc-signature"/g)).toHaveLength(2);
  });

  it('บริษัทไม่มีที่อยู่/เลขภาษี → ไม่พิมพ์บรรทัดว่าง', () => {
    const html = buildAfterSalesDocHtml(
      doc({ company: { nameTh: 'BESTCHOICE', address: '', taxId: '', phone: null } }),
    );
    expect(html).not.toContain('เลขประจำตัวผู้เสียภาษี');
    expect(html).not.toContain('<p></p>');
  });

  it('escape ข้อความลูกค้าทุกบล็อก', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          { type: 'box', title: 'อาการที่ลูกค้าแจ้ง', text: '<script>alert(1)</script> & "x"' },
          { type: 'checks', label: 'อุปกรณ์', items: [{ text: '<b>เคส</b>', checked: true }] },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(html).toContain('&lt;b&gt;เคส&lt;/b&gt;');
  });

  it('pair / section / table เรนเดอร์ครบ + แถวตัวหนา', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'pair',
            left: {
              title: 'ลูกค้า (ผู้ฝาก)',
              rows: [{ label: 'ชื่อ', value: 'สมชาย', strong: true }],
            },
            right: {
              title: 'ที่มาของเครื่อง',
              rows: [{ label: 'ซื้อแบบ', value: 'สัญญาผ่อน CT-1' }],
            },
          },
          {
            type: 'section',
            section: { title: 'ผลการซ่อม', rows: [{ label: 'ซ่อมที่', value: 'ซ่อมที่ร้าน' }] },
          },
          {
            type: 'table',
            title: 'เปลี่ยนเครื่อง',
            head: ['', 'เครื่อง', 'IMEI'],
            rows: [
              ['เครื่องเดิม', 'A55', '111'],
              ['เครื่องที่ส่งมอบ', 'A55', '222'],
            ],
            strongRows: [1],
          },
        ],
      }),
    );
    expect(html).toContain('<strong>สมชาย</strong>');
    expect(html).toContain('สัญญาผ่อน CT-1');
    expect(html).toContain('ซ่อมที่ร้าน');
    expect(html).toContain('<td><strong>222</strong></td>');
    expect(html).toContain('<td>111</td>');
  });

  it('table nowrapCols: เซลล์ IMEI/Serial ได้ class as-nowrap (ทั้งแถวปกติและแถวตัวหนา) + กฎ CSS ชนะ overflow-wrap:anywhere ของ shared', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'table',
            title: 'เครื่องที่ส่งมอบ',
            head: ['เครื่อง', 'IMEI', 'Serial', 'หมายเหตุ'],
            rows: [
              ['iPhone 13', '356812345674412', 'F2LXK3P09Q', 'ซ่อมแล้ว'],
              ['iPhone 14', '356812345679999', 'G7QWE1234Z', 'ใหม่'],
            ],
            strongRows: [1],
            nowrapCols: [1, 2],
          },
        ],
      }),
    );
    expect(html).toContain(
      '<tr><th>เครื่อง</th><th class="as-nowrap">IMEI</th><th class="as-nowrap">Serial</th><th>หมายเหตุ</th></tr>',
    );
    expect(html).toContain(
      '<tr><td>iPhone 13</td><td class="as-nowrap">356812345674412</td><td class="as-nowrap">F2LXK3P09Q</td><td>ซ่อมแล้ว</td></tr>',
    );
    expect(html).toContain(
      '<td class="as-nowrap"><strong>356812345679999</strong></td><td class="as-nowrap"><strong>G7QWE1234Z</strong></td>',
    );
    // shared: `body :is(td,th) { … overflow-wrap: anywhere; }` (0,0,2) — กฎนี้ (0,1,2) ต้องมาทีหลังและชนะ
    const rule = 'body :is(td,th).as-nowrap { white-space: nowrap; overflow-wrap: normal; }';
    expect(html).toContain(rule);
    expect(html.indexOf(rule)).toBeGreaterThan(html.indexOf('body :is(td,th) {'));
  });

  it('table ไม่ระบุ nowrapCols → ไม่มี class as-nowrap บนเซลล์', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [{ type: 'table', title: 't', head: ['a', 'b'], rows: [['1', '2']] }],
      }),
    );
    expect(html).toContain('<tr><td>1</td><td>2</td></tr>');
    expect(html).not.toContain('class="as-nowrap"');
  });

  it('T3/m10 กลุ่มปิดท้าย: ห้ามแยกหน้า + เว้นบน 1mm (สระ/วรรณยุกต์บนบรรทัดแรกไม่ค้างท้ายหน้าก่อน)', () => {
    const html = buildAfterSalesDocHtml(doc());
    expect(html).toContain('.as-closing {');
    expect(html).toContain('.as-closing { break-inside: avoid; padding-top: 1mm; }');
  });

  it('conditions: เรนเดอร์เป็นรายการ + อยู่ในกลุ่มปิดท้ายเดียวกับ ack/ลายเซ็น/footer (ห้ามแยกหน้า)', () => {
    const html = buildAfterSalesDocHtml(
      doc({ conditions: { title: 'เงื่อนไขการรับฝาก', items: ['ข้อหนึ่ง', 'ข้อสอง'] } }),
    );
    expect(html).toContain('<ol class="as-list"><li>ข้อหนึ่ง</li><li>ข้อสอง</li></ol>');
    const closing = html.slice(html.indexOf('<div class="as-closing">'));
    expect(closing).toContain('<ol class="as-list">');
    expect(closing).toContain('as-ack');
    expect(closing.match(/bc-doc-signature/g)).toHaveLength(2);
    expect(closing).toContain(DOC_NOT_RECEIPT);
  });

  it('ไม่มี conditions (ใบส่งมอบ) → ไม่พิมพ์ <ol class="as-list">', () => {
    const html = buildAfterSalesDocHtml(doc());
    expect(html).not.toContain('<ol class="as-list">');
  });

  it('checks: ✓ เท่าจำนวนที่ติ๊ก + ช่อง trailing', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'checks',
            label: 'อุปกรณ์ที่ฝากมาด้วย',
            items: [
              { text: 'กล่อง', checked: true },
              { text: 'เคส', checked: false },
            ],
            trailing: { text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: true },
          },
        ],
      }),
    );
    expect(html.match(/<span class="as-box">✓<\/span>/g)).toHaveLength(2);
    expect(html).toContain('as-check as-trailing');
  });

  it('photos: รูปที่ถูกต้องได้ <img data-thumb> + สคริปต์ย่อรูป · ช่องว่างใช้ emptyText · src อื่นถือว่าไม่มีรูป', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'photos',
            title: 'สภาพเครื่องตอนรับฝาก',
            photos: [
              { angle: 'หน้า', dataUrl: PNG_1PX, emptyText: 'ไม่ได้ถ่าย' },
              { angle: 'หลัง', dataUrl: 'javascript:alert(1)', emptyText: 'เปิดรูปไม่ได้' },
              { angle: 'ซ้าย', dataUrl: 'data:text/html;base64,PHA+', emptyText: 'เปิดรูปไม่ได้' },
              { angle: 'ขวา', dataUrl: null, emptyText: 'ไม่ได้ถ่าย' },
            ],
          },
        ],
      }),
    );
    expect(html.match(/<img data-thumb/g)).toHaveLength(1);
    expect(html).toContain(`src="${PNG_1PX}"`);
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('data:text/html');
    // นับเฉพาะช่องรูป (สคริปต์ย่อรูปก็มีคำนี้เป็น alt สำรอง)
    expect(html.match(/<span>เปิดรูปไม่ได้<\/span>/g)).toHaveLength(2);
    expect(html).toContain('window.__afterSalesThumbs');
  });

  it('สคริปต์ย่อรูป: ทีละรูป (ต่อ promise chain ไม่ใช่ Promise.all) + ปูพื้นขาวก่อนวาด (PNG โปร่งใสไม่ออกดำ)', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'photos',
            title: 'สภาพเครื่องตอนรับฝาก',
            photos: [{ angle: 'หน้า', dataUrl: PNG_1PX, emptyText: 'ไม่ได้ถ่าย' }],
          },
        ],
      }),
    );
    const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
    expect(script).not.toContain('Promise.all');
    expect(script).toContain('.reduce.call(');
    expect(script).toContain('Promise.resolve()');
    expect(script).toContain("ctx.fillStyle = '#ffffff';");
    expect(script).toContain('ctx.fillRect(0, 0, w, h);');
    expect(script.indexOf('ctx.fillRect(0, 0, w, h);')).toBeLessThan(
      script.indexOf('ctx.drawImage(img, 0, 0, w, h);'),
    );
  });

  it('ไม่มีรูปที่ใช้ได้ → ไม่ใส่สคริปต์ย่อรูป', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'photos',
            title: 'สภาพเครื่องตอนรับฝาก',
            photos: [{ angle: 'หน้า', dataUrl: null, emptyText: 'ไม่ได้ถ่าย' }],
          },
        ],
      }),
    );
    expect(html).not.toContain('window.__afterSalesThumbs');
  });

  it('escapeHtml + โลโก้ gradient id ไม่ชนของเดิม', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;',
    );
    expect(AFTER_SALES_LOGO_SVG.startsWith('<svg')).toBe(true);
    expect(AFTER_SALES_LOGO_SVG).toContain('id="bc-as-doc"');
    expect(AFTER_SALES_LOGO_SVG).not.toContain('id="bc-as"');
  });

  it('@page เอกสารนี้ (14mm 15mm) มาทีหลัง @page ของ shared (18mm 15mm) — ชนะใน cascade', () => {
    const html = buildAfterSalesDocHtml(doc());
    const sharedPageRule = '@page { size: A4; margin: 18mm 15mm; }';
    const asPageRule = '@page { size: A4; margin: 14mm 15mm; }';
    expect(html).toContain(sharedPageRule);
    expect(html).toContain(asPageRule);
    expect(html.indexOf(asPageRule)).toBeGreaterThan(html.indexOf(sharedPageRule));
  });
});
