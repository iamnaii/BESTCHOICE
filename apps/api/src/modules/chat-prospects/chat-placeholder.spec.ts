import { ChatChannel } from '@prisma/client';
import {
  isChatPlaceholder,
  isLivePlaceholder,
  placeholderName,
  PLACEHOLDER_FIELDS_SELECT,
} from './chat-placeholder';

describe('isChatPlaceholder', () => {
  it('CHAT_* + ไม่มีเบอร์ + ไม่มีเลขบัตร = placeholder', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null })).toBe(true);
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_LINE_SHOP', phone: null, nationalId: null })).toBe(true);
  });
  it('เติมเบอร์หรือเลขบัตรแล้ว = ผู้สนใจธรรมดา ไม่ใช่ placeholder', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null })).toBe(false);
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: '1234567890123' })).toBe(false);
  });
  it('ที่มาอื่น (บอท / เดินเข้าร้าน / null) ไม่ใช่ placeholder แม้เบอร์ว่าง', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'AI_CHAT', phone: null, nationalId: null })).toBe(false);
    expect(isChatPlaceholder({ acquisitionSource: null, phone: null, nationalId: null })).toBe(false);
  });
});

describe('placeholderName', () => {
  it('มีชื่อจากห้อง → ใช้ชื่อนั้น (trim)', () => {
    expect(placeholderName(ChatChannel.FACEBOOK, 'psid-1234567890', '  สมชาย ใจดี ')).toBe('สมชาย ใจดี');
  });
  it('ไม่มีชื่อ → ป้ายช่องทาง + รหัส 4 ตัวท้าย', () => {
    expect(placeholderName(ChatChannel.FACEBOOK, 'psid-1234567890', null)).toBe('Facebook #7890');
    expect(placeholderName(ChatChannel.LINE_SHOP, 'Uabc123def', '')).toBe('LINE #3def');
    expect(placeholderName(ChatChannel.TIKTOK, 'tt-9', undefined)).toBe('TikTok #tt-9');
    expect(placeholderName(ChatChannel.WEB, 'visitor-55aa', '   ')).toBe('เว็บ #55aa');
  });
});

describe('PLACEHOLDER_FIELDS_SELECT', () => {
  it('เลือกเฉพาะ 4 ฟิลด์ที่ต้องใช้ตรวจ placeholder ที่ยังมีชีวิต', () => {
    expect(PLACEHOLDER_FIELDS_SELECT).toEqual({
      acquisitionSource: true,
      phone: true,
      nationalId: true,
      deletedAt: true,
    });
  });
});

describe('isLivePlaceholder', () => {
  it('placeholder ที่ยังไม่ถูกลบ = true', () => {
    expect(
      isLivePlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null }),
    ).toBe(true);
  });
  it('placeholder ที่ถูก soft-delete แล้ว (ถูกรวมไปแล้ว) = false', () => {
    expect(
      isLivePlaceholder({
        acquisitionSource: 'CHAT_FACEBOOK',
        phone: null,
        nationalId: null,
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBe(false);
  });
  it('มีเบอร์แล้ว (ไม่ใช่ placeholder) แม้ deletedAt เป็น null = false', () => {
    expect(
      isLivePlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null, deletedAt: null }),
    ).toBe(false);
  });
  it('null หรือ undefined = false', () => {
    expect(isLivePlaceholder(null)).toBe(false);
    expect(isLivePlaceholder(undefined)).toBe(false);
  });
});
