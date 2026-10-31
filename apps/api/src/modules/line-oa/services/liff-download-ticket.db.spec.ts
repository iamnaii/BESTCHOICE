/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/line-oa/services/liff-download-ticket.db.spec.ts --runInBand
 *
 * Task 22 M-3 — ตั๋วดาวน์โหลดครั้งเดียวของหน้า LIFF (แทน `?idToken=`) บน Postgres จริง: เก็บเฉพาะ hash · ใช้ได้ครั้งเดียว
 * (รวมคำขอพร้อมกัน) · หมดอายุ · ผิดเอกสาร/ผิดชนิด = ใช้ไม่ได้และตั๋วถูกเผา
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  LIFF_DOWNLOAD_TICKET_KEY_PREFIX,
  LIFF_DOWNLOAD_TICKET_TTL_MS,
  LiffDownloadTicketService,
} from './liff-download-ticket.service';

const prisma = new PrismaClient();
const service = new LiffDownloadTicketService(prisma as never);
const tag = `t22-${Date.now()}`;
const LINE_A = `U${tag}-a`;
const RECEIPT = '0b9c1a52-2f0c-4b8e-9d55-6f0a8e1d2c3b';
const OTHER_RECEIPT = '7d4e2a10-1c3b-4f6a-8e2d-9b0c5a1f3e47';
const keyOf = (ticket: string) =>
  `${LIFF_DOWNLOAD_TICKET_KEY_PREFIX}${createHash('sha256').update(ticket).digest('hex')}`;
const issued: string[] = [];
const issue = async (...args: Parameters<LiffDownloadTicketService['issue']>) => {
  const ticket = await service.issue(...args);
  issued.push(keyOf(ticket));
  return ticket;
};

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
});

afterAll(async () => {
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { in: issued } } });
  await prisma.$disconnect();
});

describe('LiffDownloadTicketService (real Postgres)', () => {
  it('ตั๋ว ≥ 128 บิต · DB เก็บเฉพาะ sha256 ของตั๋ว (ไม่มีตั๋วดิบในแถว) · อายุ 60 วิ', async () => {
    const before = Date.now();
    const ticket = await issue(LINE_A, 'receipt', RECEIPT);
    expect(Buffer.from(ticket, 'base64url').length).toBeGreaterThanOrEqual(16);
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: keyOf(ticket) },
    });
    expect(JSON.stringify(row)).not.toContain(ticket);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + LIFF_DOWNLOAD_TICKET_TTL_MS - 1000,
    );
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + LIFF_DOWNLOAD_TICKET_TTL_MS);
  });

  it('ใช้ได้ครั้งเดียว: ครั้งแรกได้ LINE ที่ผูกไว้ · ครั้งที่สอง null', async () => {
    const ticket = await issue(LINE_A, 'receipt', RECEIPT);
    await expect(service.consume(ticket, 'receipt', RECEIPT)).resolves.toBe(LINE_A);
    await expect(service.consume(ticket, 'receipt', RECEIPT)).resolves.toBeNull();
  });

  it('ยิงพร้อมกัน 5 คำขอ → ผ่านคำขอเดียว', async () => {
    const ticket = await issue(LINE_A, 'contract-document', RECEIPT);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.consume(ticket, 'contract-document', RECEIPT)),
    );
    expect(results.filter((r) => r === LINE_A)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(4);
  });

  it('ผิดเอกสาร → null และตั๋วถูกเผา (ใช้กับเอกสารที่ถูกก็ไม่ได้แล้ว)', async () => {
    const ticket = await issue(LINE_A, 'receipt', RECEIPT);
    await expect(service.consume(ticket, 'receipt', OTHER_RECEIPT)).resolves.toBeNull();
    await expect(service.consume(ticket, 'receipt', RECEIPT)).resolves.toBeNull();
  });

  it('ผิดชนิดเอกสาร (ตั๋วใบเสร็จใช้เปิดสัญญาที่ id เดียวกัน) → null', async () => {
    const ticket = await issue(LINE_A, 'receipt', RECEIPT);
    await expect(service.consume(ticket, 'contract-document', RECEIPT)).resolves.toBeNull();
  });

  it('หมดอายุ → null', async () => {
    const ticket = await issue(LINE_A, 'receipt', RECEIPT);
    await prisma.chatbotOtpRequest.update({
      where: { lineUserId: keyOf(ticket) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.consume(ticket, 'receipt', RECEIPT)).resolves.toBeNull();
  });

  it('ตั๋วที่ไม่มีจริง / ว่าง / ไม่ส่ง → null', async () => {
    await expect(service.consume('not-a-ticket', 'receipt', RECEIPT)).resolves.toBeNull();
    await expect(service.consume('', 'receipt', RECEIPT)).resolves.toBeNull();
    await expect(service.consume(undefined, 'receipt', RECEIPT)).resolves.toBeNull();
  });
});
