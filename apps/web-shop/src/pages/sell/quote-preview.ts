import Decimal from 'decimal.js';
import type { BuybackQuestion, BuybackQuestionsResponse } from '@/types/buyback';

export type Answers = Record<string, string[]>;

/** Informational preview only; the server supplies the final quote. */
export function previewPrice(
  maxPrice: string,
  questions: BuybackQuestion[],
  answers: Answers,
  mode: BuybackQuestionsResponse['pricingMode'] = 'SUM_PERCENT_FLOOR10',
  bonusPct = '10',
): { price: number; exchangePrice: number; complete: boolean } {
  let fixed = new Decimal(0);
  let pct = new Decimal(0);
  let complete = questions.length > 0;
  for (const question of questions) {
    const chosen = answers[question.key];
    if (!chosen || (question.selectType === 'SINGLE' && chosen.length !== 1)
      || new Set(chosen).size !== chosen.length) complete = false;
    for (const id of chosen ?? []) {
      const choice = question.choices.find((candidate) => candidate.id === id);
      if (!choice || choice.isNoneChoice) {
        complete = false;
        continue;
      }
      if (choice.deductType === 'FIXED') fixed = fixed.plus(choice.deductValue);
      else pct = mode === 'MAX_PERCENT_EXACT'
        ? Decimal.max(pct, choice.deductValue)
        : pct.plus(choice.deductValue);
    }
  }
  const raw = Decimal.max(new Decimal(maxPrice).minus(fixed), 0)
    .mul(new Decimal(100).minus(Decimal.min(pct, 100))).div(100);
  const price = mode === 'MAX_PERCENT_EXACT' ? raw.toDecimalPlaces(2) : raw.div(10).floor().mul(10);
  const exchangePrice = price.mul(new Decimal(100).plus(bonusPct)).div(100).div(10).floor().mul(10);
  return { price: price.toNumber(), exchangePrice: Decimal.max(exchangePrice, 0).toNumber(), complete };
}
