import { describe, it, expect } from 'vitest';
import { numToThaiText } from '../numToThaiText';

describe('numToThaiText', () => {
  it('handles zero', () => {
    expect(numToThaiText(0)).toBe('ศูนย์บาทถ้วน');
  });

  it('renders single-digit baht', () => {
    expect(numToThaiText(1)).toBe('หนึ่งบาทถ้วน');
    expect(numToThaiText(9)).toBe('เก้าบาทถ้วน');
  });

  it('renders tens with เอ็ด rule', () => {
    expect(numToThaiText(11)).toBe('สิบเอ็ดบาทถ้วน');
    expect(numToThaiText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(numToThaiText(20)).toBe('ยี่สิบบาทถ้วน');
    expect(numToThaiText(31)).toBe('สามสิบเอ็ดบาทถ้วน');
  });

  it('renders hundreds and thousands', () => {
    expect(numToThaiText(100)).toBe('หนึ่งร้อยบาทถ้วน');
    expect(numToThaiText(1000)).toBe('หนึ่งพันบาทถ้วน');
    expect(numToThaiText(4815)).toBe('สี่พันแปดร้อยสิบห้าบาทถ้วน');
  });

  it('renders ล้าน', () => {
    expect(numToThaiText(1_000_000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(numToThaiText(2_500_000)).toBe('สองล้านห้าแสนบาทถ้วน');
  });

  it('renders satang', () => {
    expect(numToThaiText(4815.5)).toBe('สี่พันแปดร้อยสิบห้าบาทห้าสิบสตางค์');
    expect(numToThaiText(0.75)).toBe('ศูนย์บาทเจ็ดสิบห้าสตางค์');
    expect(numToThaiText(1.01)).toBe('หนึ่งบาทหนึ่งสตางค์');
  });

  it('handles negative', () => {
    expect(numToThaiText(-500)).toBe('ลบห้าร้อยบาทถ้วน');
  });

  it('handles string input', () => {
    expect(numToThaiText('1234.50')).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์');
  });

  it('returns empty for invalid', () => {
    expect(numToThaiText(NaN)).toBe('');
    expect(numToThaiText('not a number')).toBe('');
  });
});
