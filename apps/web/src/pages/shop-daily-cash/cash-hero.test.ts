import { describe, expect, it } from 'vitest';
import { pickHero, shiftDate, weekdayShort } from './cash-hero';
import type { CashClose, CashCloseStatusResponse, CashHolding } from './cash-close';

const close = (over: Partial<CashClose> = {}): CashClose => ({
  id: 'cl-1', branchId: 'br-1', branchName: 'ลพบุรี', status: 'PENDING_CONFIRM', attemptNo: 1, periodStart: null,
  countedAt: '2026-09-21T13:40:00.000Z', floatAmount: 1000, cashIn: 16500, cashOut: 5790, expectedAmount: 11710, countedAmount: 11510,
  varianceAmount: -200, varianceReason: 'ทอนผิด', sendAmount: 10510, countedBy: { id: 'u-bm', name: 'ผจก.' },
  receivedAmount: null, receiveVariance: null, receiveNote: null, destination: null, confirmedBy: null, confirmedAt: null,
  sentBackBy: null, sentBackAt: null, sentBackReason: null, journalPosted: false,
  depositReference: null, hasDepositSlip: false, moneyState: 'AWAITING_CONFIRM', ...over,
});
const confirmed = (over: Partial<CashClose> = {}) => close({ status: 'CONFIRMED', receivedAmount: 10510, destination: 'BANK_DEPOSIT', moneyState: 'REACHED',
  confirmedAt: '2026-09-21T13:52:00.000Z', confirmedBy: { id: 'u-owner', name: 'เจ้าของ' }, ...over });
const safeHolding = (canDeposit: boolean): CashHolding => ({ branchId: 'br-1', branchName: 'ลพบุรี', source: 'BRANCH_SAFE', sourceLabel: 'ตู้เซฟสาขา',
  reachedCompany: false, outstanding: 10510, closeCount: 1, oldestConfirmedAt: '2026-09-21T13:52:00.000Z', openCloses: [], canDeposit });

const owner = { canCount: false, canConfirm: true, viewerId: 'u-owner', viewerRole: 'OWNER' };
const manager = { canCount: true, canConfirm: true, viewerId: 'u-bm', viewerRole: 'BRANCH_MANAGER' };
const cashRound = { periodStart: null, floatAmount: 1000, cashIn: 16500, cashOut: 5790, expectedAmount: 11710, movementCount: 9 };
const emptyRound = { periodStart: null, floatAmount: 1000, cashIn: 0, cashOut: 0, expectedAmount: 1000, movementCount: 0 };

const status = (over: Partial<CashCloseStatusResponse> = {}): CashCloseStatusResponse => ({
  date: '2026-09-21', asOf: '2026-09-21T13:00:00.000Z', branchId: 'br-1', branchName: 'ลพบุรี', round: cashRound,
  closes: [], awaitingConfirm: [], permissions: manager,
  readiness: { hasDrawerAccount: true, floatAmount: 1000, counters: [{ id: 'u-bm', name: 'ผจก.', role: 'BRANCH_MANAGER' }] },
  holdings: [], ...over,
});

describe('pickHero — กล่องสถานะเลือกเรื่องเดียวขึ้นเป็นตัวใหญ่ (สิ่งที่ผู้เปิดดูต้องกดเองมาก่อน)', () => {
  it('มีเงินสดในรอบ: ผู้ส่งยอด = SEND (ต้องลงมือ) · เจ้าของ = WAIT_SEND (รอคนอื่น ไม่มีปุ่ม)', () => {
    expect(pickHero(status(), true)).toMatchObject({ kind: 'SEND', viewerActs: true, roundPending: false, resend: false });
    expect(pickHero(status({ permissions: owner }), true)).toMatchObject({ kind: 'WAIT_SEND', viewerActs: false });
  });

  it('ไม่มีเงินสดในรอบ = NO_CASH ทั้งผู้ส่งยอดและเจ้าของ (วันไม่มีเงินสดไม่ต้องส่งยอด) · วันย้อนหลังที่ไม่มีอะไร = EMPTY_DAY', () => {
    expect(pickHero(status({ round: emptyRound }), true).kind).toBe('NO_CASH');
    expect(pickHero(status({ round: emptyRound, permissions: owner }), true).kind).toBe('NO_CASH');
    expect(pickHero(status(), false).kind).toBe('EMPTY_DAY'); // รอบปัจจุบันไม่เกี่ยวกับวันย้อนหลัง
  });

  it('ยอดรอยืนยัน: คนอื่นที่มีสิทธิ์ = CONFIRM · ผู้ส่งยอดเอง = WAIT_CONFIRM แม้มีสิทธิ์ยืนยัน', () => {
    const pending = close();
    expect(pickHero(status({ permissions: owner, awaitingConfirm: [pending], closes: [pending], round: emptyRound }), true)).toMatchObject({ kind: 'CONFIRM', viewerActs: true, close: pending });
    expect(pickHero(status({ awaitingConfirm: [pending], closes: [pending], round: emptyRound }), true)).toMatchObject({ kind: 'WAIT_CONFIRM', viewerActs: false });
  });

  it('ผู้จัดการที่ต้องยืนยันยอดของคนอื่น และมีรอบใหม่ให้ส่งด้วย: ยืนยันมาก่อน รอบใหม่ลงไปเป็นแถวรอง', () => {
    const pending = close({ countedBy: { id: 'u-sales', name: 'ธนา' } });
    expect(pickHero(status({ awaitingConfirm: [pending], closes: [pending] }), true)).toMatchObject({ kind: 'CONFIRM', roundPending: true });
  });

  it('เงินในตู้เซฟสาขา: มีสิทธิ์นำฝาก = DEPOSIT แบบต้องลงมือ · ไม่มีสิทธิ์ = DEPOSIT แบบรอ', () => {
    const safe = confirmed({ destination: 'BRANCH_SAFE', moneyState: 'AT_BRANCH' });
    expect(pickHero(status({ permissions: owner, closes: [safe], holdings: [safeHolding(true)], round: emptyRound }), true)).toMatchObject({ kind: 'DEPOSIT', viewerActs: true });
    expect(pickHero(status({ permissions: { canCount: true, canConfirm: false, viewerId: 'u-sales' }, closes: [safe], holdings: [safeHolding(false)], round: emptyRound }), true))
      .toMatchObject({ kind: 'DEPOSIT', viewerActs: false });
  });

  it('เงินถึงบริษัทแล้วและไม่มีอะไรค้าง = DONE · ถ้ามีรอบใหม่ที่มีเงินสด ผู้ส่งยอดเห็น SEND และครั้งที่จบแล้วเป็นแถวรอง', () => {
    const done = confirmed();
    expect(pickHero(status({ permissions: owner, closes: [done], round: emptyRound }), true)).toMatchObject({ kind: 'DONE', close: done, rest: [] });
    const again = pickHero(status({ closes: [done] }), true);
    expect(again.kind).toBe('SEND');
    expect(again.rest).toEqual([done]);
    expect(again.resend).toBe(false);
  });

  it('ถูกตีกลับและยังไม่มีการส่งใหม่ = SEND แบบ "ส่งอีกครั้ง"', () => {
    const back = close({ status: 'SENT_BACK', moneyState: 'SENT_BACK', sentBackReason: 'นับใหม่' });
    expect(pickHero(status({ closes: [back] }), true)).toMatchObject({ kind: 'SEND', resend: true });
  });

  it('ดูวันย้อนหลัง: เรื่องหลักเป็นของวันนั้น — ยอดรอยืนยันของวันอื่นลงไปเป็นแถวรอง (ยังกดยืนยันได้)', () => {
    const pendingToday = close({ id: 'today' });
    const past = pickHero(status({ permissions: owner, awaitingConfirm: [pendingToday], closes: [] }), false);
    expect(past).toMatchObject({ kind: 'EMPTY_DAY', close: null, rest: [pendingToday] });
    const doneThatDay = confirmed({ id: 'that-day' });
    expect(pickHero(status({ permissions: owner, awaitingConfirm: [pendingToday], closes: [doneThatDay] }), false)).toMatchObject({ kind: 'DONE', close: doneThatDay, rest: [pendingToday] });
    const pendingThatDay = close({ id: 'old-pending' });
    expect(pickHero(status({ permissions: owner, awaitingConfirm: [pendingThatDay], closes: [pendingThatDay] }), false)).toMatchObject({ kind: 'CONFIRM', close: pendingThatDay });
  });

  it('สาขายังไม่พร้อม (ไม่มีลิ้นชัก/ไม่มีผู้ส่งยอด) = NOT_READY แทนปุ่มส่งยอด — แต่ยอดรอยืนยันที่ค้างอยู่ยังมาก่อน', () => {
    const notReady = { hasDrawerAccount: false, floatAmount: 0, counters: [] };
    expect(pickHero(status({ readiness: notReady }), true).kind).toBe('NOT_READY');
    const pending = close({ countedBy: { id: 'u-sales', name: 'ธนา' } });
    expect(pickHero(status({ readiness: notReady, permissions: owner, awaitingConfirm: [pending], closes: [pending] }), true).kind).toBe('CONFIRM');
  });
});

describe('ตัวช่วยวันที่ของแถบ 14 วัน', () => {
  it('เลื่อนวันข้ามเดือน/ปีได้โดยไม่ผ่านเขตเวลาเครื่อง', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('ชื่อวันย่อของวันที่ตามปฏิทินไทย', () => {
    expect(weekdayShort('2026-09-21')).toBe('จ.');
    expect(weekdayShort('2026-09-13')).toBe('อา.');
  });
});
