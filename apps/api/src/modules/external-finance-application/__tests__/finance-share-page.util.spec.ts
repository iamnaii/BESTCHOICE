import { buildFinanceSharePage, buildGonePage } from '../services/finance-share-page.util';

const base = {
  nonce: 'abc',
  number: 'BC-260924-001',
  status: 'SENT' as const,
  expiresAt: new Date('2026-10-01T10:00:00+07:00'),
  messageText: '1.ชื่อลูกค้า : สมหญิง <ใจดี>\n2.อาชีพ : พนักงาน',
  groups: [
    { slot: 'ID_CARD' as const, label: 'บัตรประชาชน', files: [{ id: 'f1', mimeType: 'image/jpeg', size: 1234, originalName: 'บัตร.jpg', url: '/api/g/tok/files/f1' }] },
    { slot: 'DEVICE_PHOTO' as const, label: 'รูปเครื่อง 6 มุม', files: [] },
  ],
  zipUrl: '/api/g/tok/zip',
  replyUrl: '/api/g/tok/reply',
  fileCount: 1,
  lineGroupName: 'GFIN : BESTCHOICE (67301219)',
};

describe('buildFinanceSharePage', () => {
  it('escapes user text, uses the nonce on every inline script/style, and never leaks the token into OG tags', () => {
    const html = buildFinanceSharePage(base);
    expect(html).toContain('สมหญิง &lt;ใจดี&gt;');
    expect(html).not.toContain('<ใจดี>');
    expect(html).toMatch(/<meta property="og:title" content="BESTCHOICE — ชุดเช็คเครดิต"/);
    expect(html).not.toMatch(/og:.*tok/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const scripts = html.match(/<script/g) ?? [];
    const noncedScripts = html.match(/<script nonce="abc"/g) ?? [];
    expect(scripts.length).toBe(noncedScripts.length);
    expect(html).toContain('viewport');
    expect(html).toContain('id="lightbox"');
    expect(html).toContain('fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai');
  });
  it('renders the 4 reply choices + name field + D7 disclaimer only for an open application, and the result banner when closed', () => {
    const html = buildFinanceSharePage(base);
    for (const a of ['ACK', 'MORE_INFO', 'APPROVED', 'REJECTED']) expect(html).toContain(`data-reply="${a}"`);
    expect(html).toContain('id="name"');
    expect(html).toContain('ไม่ใช่การอนุมัติทางการ');
    const closed = buildFinanceSharePage({ ...base, status: 'APPROVED' });
    expect(closed).not.toContain('data-reply="APPROVED"');
    expect(closed).toContain('ผ่าน (แจ้งผ่านลิงก์)');
  });
  it('hides empty groups and shows the file count in the download button', () => {
    const html = buildFinanceSharePage(base);
    expect(html).not.toContain('รูปเครื่อง 6 มุม');
    expect(html).toContain('ดาวน์โหลดทั้งหมด (1 ไฟล์)');
  });
  it('gone page carries no customer data and points to the LINE group', () => {
    const html = buildGonePage('abc');
    expect(html).toContain('ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว');
    expect(html).toContain('GFIN : BESTCHOICE');
    expect(html).not.toContain('BC-');
  });

  // fix round 1 Important 4 — CSP is `style-src 'nonce-...'` with no 'unsafe-inline';
  // nonces only cover <style>/<script> elements, never a `style="..."` attribute, so any
  // inline style attribute is silently dropped by the browser. Every style must live in
  // the nonced <style> block as a class/ID selector instead.
  it('never emits an inline style="" attribute anywhere (CSP has no unsafe-inline for style-src)', () => {
    for (const status of ['SENT', 'ACKNOWLEDGED', 'MORE_INFO', 'APPROVED', 'CANCELLED'] as const) {
      const html = buildFinanceSharePage({ ...base, status });
      expect(html).not.toMatch(/\sstyle="/);
    }
    expect(buildGonePage('abc')).not.toMatch(/\sstyle="/);
  });

  // fix round 1 Minor 7 — PARTNER_ACK is only allowed from SENT (finance-application-status.util.ts);
  // showing the ACK button on MORE_INFO/ACKNOWLEDGED would always 409 on click.
  it('shows the ACK button only when status is SENT — MORE_INFO keeps the other 3 choices without it', () => {
    const moreInfo = buildFinanceSharePage({ ...base, status: 'MORE_INFO' });
    expect(moreInfo).not.toContain('data-reply="ACK"');
    for (const a of ['MORE_INFO', 'APPROVED', 'REJECTED']) expect(moreInfo).toContain(`data-reply="${a}"`);
    const acknowledged = buildFinanceSharePage({ ...base, status: 'ACKNOWLEDGED' });
    expect(acknowledged).not.toContain('data-reply="ACK"');
    const sent = buildFinanceSharePage({ ...base, status: 'SENT' });
    expect(sent).toContain('data-reply="ACK"');
  });
});
