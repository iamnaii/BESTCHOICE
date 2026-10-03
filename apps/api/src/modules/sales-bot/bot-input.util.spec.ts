import { estimateReplyConfidence, parseRecommendationBudget } from './bot-input.util';

describe('shared production/evaluation bot policy', () => {
  it.each([
    [null, undefined],
    ['', undefined],
    ['ไม่มีงบ', undefined],
    ['3,000 บาท', 3000],
    ['3 พัน', 3000],
    ['5k', 5000],
    ['1.5 หมื่น', 15000],
    [0, 0],
    [-1, -1],
    ['0', undefined],
    [Infinity, undefined],
  ] as const)('preserves budget parsing for %p', (input, expected) =>
    expect(parseRecommendationBudget(input)).toBe(expected),
  );
  it.each([
    ['ได้ค่ะ', [], 0.6],
    ['ยินดีค่ะ 😊', [], 0.9],
    ['  ', [], 0],
    ['ข้อมูลสินค้า', ['search_products'], 0.95],
    ['ได้ค่ะ', ['handoff_to_human'], 0.3],
    ['', ['handoff_to_human'], 0.3],
  ] as const)('preserves confidence for %s with %p', (reply, tools, expected) =>
    expect(estimateReplyConfidence(reply, [...tools])).toBe(expected),
  );
});
