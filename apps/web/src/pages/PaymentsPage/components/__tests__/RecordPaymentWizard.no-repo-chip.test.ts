/// <reference types="node" />
/**
 * JP5 starts from a device-return intake on /repossessions, never the payment wizard.
 * Source assertions cover removal of this entry without mocking the wizard's payment APIs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const source = readFileSync(resolve(__dirname, '../RecordPaymentWizard.tsx'), 'utf8');

describe('RecordPaymentWizard — device returns leave the payment wizard', () => {
  it('has no REPO chip, overlay import/mount, state or orphaned setter', () => {
    expect(source).not.toContain("key: 'REPO'");
    expect(source).not.toContain('showRepoOverlay');
    expect(source).not.toContain('setShowRepoOverlay');
    expect(source).not.toContain('RepossessionOverlay');
  });

  it('retains normal, partial, advance, payoff and reschedule payment chips', () => {
    for (const key of ['NORMAL', 'PARTIAL', 'OVERPAY_ADVANCE', 'PAYOFF', 'RESCHEDULE']) {
      expect(source).toContain(`key: '${key}'`);
    }
  });
});
