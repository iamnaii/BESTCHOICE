import { describe, expect, it } from 'vitest';
import type { BuybackQuestion } from '@/types/buyback';
import { previewPrice } from './quote-preview';

const questions: BuybackQuestion[] = [
  { id: 'body', key: 'body', title: 'ตัวเครื่อง', helpText: null, selectType: 'SINGLE', choices: [
    { id: 'body-good', label: 'ปกติ', deductType: 'PERCENT', deductValue: '0' },
    { id: 'scratch', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' },
  ] },
  { id: 'battery', key: 'battery', title: 'แบตเตอรี่', helpText: null, selectType: 'SINGLE', choices: [
    { id: 'low', label: 'ต่ำกว่า 80%', deductType: 'FIXED', deductValue: '1500' },
  ] },
  { id: 'functions', key: 'functions', title: 'การใช้งาน', helpText: null, selectType: 'MULTI', choices: [
    { id: 'sound', label: 'ลำโพง', deductType: 'PERCENT', deductValue: '22' },
    { id: 'camera', label: 'กล้อง', deductType: 'PERCENT', deductValue: '37' },
  ] },
];

describe('buyback quote preview', () => {
  it('uses the largest percentage across all questions after fixed deductions without rounding cash to tens', () => {
    expect(previewPrice('5001', questions, { body: ['scratch'], battery: ['low'], functions: ['sound', 'camera'] }, 'MAX_PERCENT_EXACT', '10'))
      .toEqual({ price: 2205.63, exchangePrice: 2420, complete: true });
  });
  it('keeps the legacy sum percentage and floor-to-ten calculation by default', () => {
    expect(previewPrice('5001', questions, { body: ['scratch'], battery: ['low'], functions: ['sound', 'camera'] }, undefined, '10'))
      .toEqual({ price: 910, exchangePrice: 1000, complete: true });
  });
  it('requires an explicit answer for MULTI but accepts an explicit empty array', () => {
    expect(previewPrice('5000', questions, { body: ['body-good'], battery: ['low'] }).complete).toBe(false);
    expect(previewPrice('5000', questions, { body: ['body-good'], battery: ['low'], functions: [] }).complete).toBe(true);
  });
  it('rejects missing, invalid, duplicate and multiple SINGLE choices', () => {
    for (const body of [[], ['missing'], ['scratch', 'body-good'], ['scratch', 'scratch']]) {
      expect(previewPrice('5000', questions, { body, battery: ['low'], functions: [] }).complete).toBe(false);
    }
    expect(previewPrice('5000', questions, { body: ['scratch'], battery: ['low'], functions: ['missing'] }).complete).toBe(false);
  });
  it('does not offer a price for an empty questionnaire and clamps a negative balance to zero', () => {
    expect(previewPrice('5000', [], {}).complete).toBe(false);
    expect(previewPrice('1000', questions, { body: ['scratch'], battery: ['low'], functions: [] }, 'MAX_PERCENT_EXACT').price).toBe(0);
  });
  it('rounds exact cash to two decimal places using decimal arithmetic', () => {
    const fractional: BuybackQuestion[] = [{ ...questions[0], choices: [
      { id: 'fraction', label: 'ทดสอบ', deductType: 'PERCENT', deductValue: '10.5' },
    ] }];
    expect(previewPrice('10.30', fractional, { body: ['fraction'] }, 'MAX_PERCENT_EXACT').price).toBe(9.22);
  });
});
