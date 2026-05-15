// Anti-regression test for P13 SSOT (PR #847 / accountant ImplementationReview v1.2 page 11).
//
// Rule: account names rendered in JE preview MUST come from the chart_of_accounts
// (via useCoaByCodes / useCoaGroups) — NEVER hardcoded in the calculation hook.
//
// Hardcoding example (BAD — what this test catches):
//   accountName: 'Dr ภาษีซื้อ'
//   accountName: `Cr WHT ${formType}`
//
// Correct pattern (what should be in the hook):
//   accountName: accountName(values.vatAccount)   // resolved via useCoaByCodes lookup
//
// If this test fails, it means a developer added a hardcoded accountName literal.
// Replace it with a lookup against the CoA map (see existing pattern in the hook).

import { describe, it, expect } from 'vitest';
// Vite's ?raw suffix imports file contents as a string at build/test time —
// no Node fs API required, keeping this test web-tsconfig-friendly.
import useAssetCalculationSource from '../useAssetCalculation.ts?raw';
import useDisposalCalculationSource from '../useDisposalCalculation.ts?raw';

const FILES_UNDER_RULE: Array<{ name: string; source: string }> = [
  { name: 'useAssetCalculation.ts', source: useAssetCalculationSource },
  { name: 'useDisposalCalculation.ts', source: useDisposalCalculationSource },
];

// Forbidden patterns: accountName followed by a string literal (single, double, or template).
// We allow: accountName: accountName(...) — function call returning a looked-up name.
// We also allow `code` (the fallback when CoA hasn't loaded — see hook implementation).
const FORBIDDEN_PATTERNS: RegExp[] = [
  /accountName:\s*'[^']+'/,             // accountName: 'literal'
  /accountName:\s*"[^"]+"/,             // accountName: "literal"
  /accountName:\s*`[^`]*\$\{[^}]*\}[^`]*`/,  // accountName: `template ${var}`
  /accountName:\s*`[^`]+`/,             // accountName: `static template`
];

describe('P13 SSOT — no hardcoded accountName in asset calculation hooks', () => {
  for (const { name, source } of FILES_UNDER_RULE) {
    it(`${name} has no hardcoded accountName literal`, () => {
      const lines = source.split('\n');

      const violations: string[] = [];
      lines.forEach((line: string, idx: number) => {
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(`  Line ${idx + 1}: ${line.trim()}`);
            break;
          }
        }
      });

      if (violations.length > 0) {
        throw new Error(
          `Found hardcoded accountName literal(s) in ${name}:\n${violations.join('\n')}\n\n` +
            `Fix: use the accountName() lookup helper from useCoaByCodes. ` +
            `See PR #847 commit acb94627 for the pattern.`,
        );
      }

      expect(violations).toHaveLength(0);
    });
  }
});
