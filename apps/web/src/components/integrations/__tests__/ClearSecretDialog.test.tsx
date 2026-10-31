import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClearSecretDialog, type ClearSecretTarget } from '../ClearSecretDialog';

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

  it('Facebook Verify Token: Messenger keeps working, only (re)subscribing the webhook needs it', () => {
    const dialog = open(t('facebook', 'Facebook Messenger', 'verifyToken', 'Webhook Verify Token'));
    expect(dialog).toHaveTextContent(
      'Facebook Messenger ยังรับส่งข้อความต่อได้ — Verify Token ใช้เฉพาะตอนยืนยัน webhook กับ Facebook (สมัครครั้งแรกหรือสมัครใหม่) ถ้าต้องยืนยันใหม่ต้องบันทึกค่าใหม่ก่อน · การ์ดจะขึ้น “ยังไม่ตั้งค่า” เพราะช่องนี้จำเป็น',
    );
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
      'ฟีเจอร์ที่ใช้คีย์จากหน้านี้จะหยุด: บอทน้องเบส · อ่านสลิป · อ่านเอกสาร (OCR) · วิเคราะห์เครดิตด้วย AI · บอทตอบแชท LINE SHOP แบบเดิม',
    );
    expect(dialog).toHaveTextContent(
      'บอทขายในอินบ็อกซ์ · ข้อความตอบนอกเวลาทำการ · ผู้ช่วย AI ของพนักงานในอินบ็อกซ์ · การดึงคลังคำตอบจากแชทเก่า ยังใช้ ANTHROPIC_API_KEY ของเซิร์ฟเวอร์ต่อไปจนกว่าผู้ดูแลระบบจะเอาออก',
    );
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
