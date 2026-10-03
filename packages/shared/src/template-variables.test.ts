import { describe, expect, it } from 'vitest';
import { extractTemplateVariables } from './template-variables';

describe('notification template variables', () => {
  it('deduplicates trimmed names in first-seen order', () => {
    expect(extractTemplateVariables('${ customer } ${amount} ${customer} ${ amount }')).toEqual(['customer', 'amount']);
  });
  it('ignores incomplete placeholders and ordinary braces', () => {
    expect(extractTemplateVariables('plain {text} ${unfinished')).toEqual([]);
  });
  it('preserves legacy whitespace-only placeholder handling', () => {
    expect(extractTemplateVariables('${ } ${}')).toEqual(['']);
  });
});
