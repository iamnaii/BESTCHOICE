import { INTEGRATIONS } from '../integrations/integration-registry';
import { sanitizeAuditValue } from './audit-sanitize.util';

/**
 * Re-review P-3: AuditInterceptor stores the body of `PUT /integrations/:key/config`
 * through sanitizeAuditValue. Every field the integration registry marks
 * `sensitive: true` must come out redacted — SMTP `email.pass` used to be stored in
 * plaintext because `pass` matched neither the name list nor /password/i.
 * Values are test-only fixtures.
 */
describe('sanitizeAuditValue — Integration Hub credentials', () => {
  const sensitive = INTEGRATIONS.flatMap((def) =>
    def.fields.filter((f) => f.sensitive).map((f) => [`${def.key}.${f.key}`, f.key] as const),
  );

  it('the registry has sensitive fields to check', () => {
    expect(sensitive.length).toBeGreaterThan(0);
  });

  it.each(sensitive)('%s is redacted in a saved config body', (_, fieldKey) => {
    const out = sanitizeAuditValue({ [fieldKey]: 'test-only-credential' }) as Record<
      string,
      unknown
    >;
    expect(out[fieldKey]).toBe('[REDACTED]');
  });

  it('SMTP body: pass is redacted, host / port / from are kept', () => {
    expect(
      sanitizeAuditValue({
        host: 'smtp.test.invalid',
        port: '465',
        user: 'resend',
        pass: 'test-only-smtp-pass',
        from: 'BESTCHOICE',
      }),
    ).toEqual({
      host: 'smtp.test.invalid',
      port: '465',
      user: 'resend',
      pass: '[REDACTED]',
      from: 'BESTCHOICE',
    });
  });
});
