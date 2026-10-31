import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  ClearSecretDialog,
  missingRequiredSecretHelp,
  type ClearSecretTarget,
} from '../ClearSecretDialog';

/**
 * Task 32 review I2 / M1 — the first paragraph says what actually stops (and what keeps
 * working) for fields whose effect was checked in the API code; everything else gets a
 * neutral sentence that does not claim more than "features that use this field stop".
 */
function open(target: ClearSecretTarget) {
  render(
    <ClearSecretDialog target={target} pending={false} onCancel={vi.fn()} onConfirm={vi.fn()} />,
  );
  return screen.getByRole('alertdialog');
}

const t = (
  integrationKey: string,
  integrationName: string,
  fieldKey: string,
  fieldLabel: string,
): ClearSecretTarget => ({ integrationKey, integrationName, fieldKey, fieldLabel });

describe('ClearSecretDialog — what clearing a field does', () => {
  it('LINE FINANCE token: the approved mockup copy, verbatim', () => {
    const dialog = open(
      t('line-finance', 'LINE FINANCE (น้องเบส)', 'channelToken', 'Channel Access Token'),
    );
    expect(dialog).toHaveTextContent(
      'LINE FINANCE (น้องเบส) จะใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่ — น้องเบสส่งข้อความหาลูกค้าไม่ได้ ทั้งบอทและพนักงานที่ตอบจากอินบ็อกซ์',
    );
    expect(dialog).toHaveTextContent('LINE Developers Console');
  });

  it.each([
    ['line-shop', 'LINE SHOP (ลูกค้า)'],
    ['line-finance', 'LINE FINANCE (น้องเบส)'],
    ['line-staff', 'LINE STAFF (พนักงาน)'],
  ])('%s Channel Secret: only inbound webhooks stop, sending keeps working', (key, name) => {
    const dialog = open(t(key, name, 'channelSecret', 'Channel Secret'));
    expect(dialog).toHaveTextContent(
      `${name} จะรับข้อความที่ส่งเข้ามาไม่ได้ — ระบบจริงปฏิเสธ webhook จาก LINE ทุกครั้งจนกว่าจะบันทึกค่าใหม่ ส่วนการส่งข้อความออกยังทำงาน`,
    );
    expect(dialog).not.toHaveTextContent('จะใช้งานไม่ได้');
  });

  it('Facebook Verify Token: only the webhook handshake stops — Messenger and page comments do not use it (Task 35)', () => {
    const dialog = open(t('facebook', 'Facebook Messenger', 'verifyToken', 'Webhook Verify Token'));
    expect(dialog).toHaveTextContent(
      'ใช้เฉพาะตอนยืนยัน webhook กับ Facebook — ล้างแล้ว การตั้งหรือแก้ Callback URL ในหน้าแอปของ Meta จะยืนยันไม่ผ่านจนกว่าจะบันทึกค่าใหม่ · ข้อความ Messenger และคอมเมนต์เพจไม่ได้ใช้ค่านี้ จึงรับส่งได้ตามเดิม',
    );
    // Task 32 copy (review N1) described the comment transport requiring this token, which
    // Task 35 removed: none of these stop any more.
    expect(dialog).not.toHaveTextContent('ฟีเจอร์คอมเมนต์เพจหยุด');
    expect(dialog).not.toHaveTextContent('ตอบคอมเมนต์จากอินบ็อกซ์ไม่ได้');
    expect(dialog).not.toHaveTextContent('ข้อความ Messenger ที่มาในคำขอเดียวกัน');
  });

  it('Yeastar Webhook Secret: production rejects every webhook — no incoming-call popup, CDRs still polled', () => {
    const dialog = open(t('yeastar', 'Yeastar PBX', 'webhookSecret', 'Webhook Secret Token'));
    expect(dialog).toHaveTextContent(
      'ระบบจริงจะปฏิเสธ webhook ของ Yeastar ทุกครั้งจนกว่าจะบันทึกค่าใหม่ — หน้าต่างสายเรียกเข้าจะไม่ขึ้นให้พนักงาน ส่วนประวัติการโทรยังเข้ามาทางรอบดึงข้อมูลทุก 15 นาที',
    );
  });

  it('Claude API Key: names what stops and what keeps running on the server key', () => {
    const dialog = open(t('claude-ai', 'Claude AI (Anthropic)', 'apiKey', 'API Key'));
    expect(dialog).toHaveTextContent(
      'ฟีเจอร์ที่อ่านคีย์ผ่านหน้านี้จะหยุด: บอทน้องเบส · อ่านสลิป · อ่านเอกสาร (OCR) · วิเคราะห์เครดิตด้วย AI · บอทตอบแชท LINE SHOP แบบเดิม',
    );
    expect(dialog).toHaveTextContent(
      'บอทขายในอินบ็อกซ์ · ข้อความตอบนอกเวลาทำการ · ผู้ช่วย AI ของพนักงานในอินบ็อกซ์ · การดึงคลังคำตอบจากแชทเก่า อ่าน ANTHROPIC_API_KEY ของเซิร์ฟเวอร์โดยตรง ไม่ได้อ่านผ่านหน้านี้ จึงไม่หยุดตาม (ต้องให้ผู้ดูแลระบบเอาออกเอง)',
    );
    // Re-review N3: the card may show that very env key, so "not the key from this page" misleads.
    expect(dialog).not.toHaveTextContent('ไม่ได้ใช้คีย์จากหน้านี้');
    expect(dialog).not.toHaveTextContent('จะใช้งานไม่ได้');
  });

  it('SMTP Password: every email the system sends today stops', () => {
    const dialog = open(t('email', 'Email (SMTP)', 'pass', 'SMTP Password'));
    expect(dialog).toHaveTextContent(
      'อีเมลที่ระบบส่งจะหยุดจนกว่าจะบันทึกค่าใหม่ — ลิงก์รีเซ็ตรหัสผ่าน อีเมลเชิญผู้ใช้ และรายงานติดตามหนี้รายสัปดาห์ (PDF)',
    );
  });

  it('any other field: a neutral sentence that does not claim the whole integration stops', () => {
    const dialog = open(t('peak', 'PEAK (บัญชี)', 'userToken', 'User Token'));
    expect(dialog).toHaveTextContent(
      'ฟีเจอร์ที่ใช้ User Token ของ PEAK (บัญชี) จะหยุดจนกว่าจะบันทึกค่าใหม่',
    );
    expect(dialog).not.toHaveTextContent('จะใช้งานไม่ได้');
    expect(dialog).toHaveTextContent(
      'ล้างทันทีที่กด และย้อนกลับไม่ได้ — ถ้าล้างผิด ต้องนำค่าใหม่มากรอกเอง',
    );
  });
});

describe('missingRequiredSecretHelp — helper under an empty required secret (re-review N2)', () => {
  it('LINE FINANCE token keeps the approved B3 copy (the dialog says the OA stops working)', () => {
    expect(missingRequiredSecretHelp('line-finance', 'channelToken')).toBe(
      'ช่องนี้จำเป็น — การเชื่อมต่อใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่',
    );
  });

  it.each([
    ['line-shop', 'channelSecret'],
    ['line-finance', 'channelSecret'],
    ['facebook', 'verifyToken'],
    ['peak', 'userToken'],
    ['claude-ai', 'apiKey'],
  ])('%s.%s never claims more than the dialog — neutral wording', (integrationKey, fieldKey) => {
    const help = missingRequiredSecretHelp(integrationKey, fieldKey);
    expect(help).toBe('ช่องนี้จำเป็น — บันทึกค่าใหม่เพื่อให้ใช้งานได้ครบ');
    expect(help).not.toContain('ใช้งานไม่ได้');
  });
});
