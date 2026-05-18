import { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from './integration-config.service';

/**
 * Focused unit tests for the C2 masked round-trip fix.
 *
 * The Integration form GET-then-POST flow hydrates sensitive fields from
 * getMaskedConfig() (which returns `••••abcd`); if the user doesn't edit
 * the field, the same mask is POSTed back on save. saveConfig MUST detect
 * this and skip persisting the literal mask — otherwise the real secret
 * gets corrupted.
 *
 * P2-SP5 surfaces this for e-Tax `certPassword` + `rdPassword`, but the
 * guard is generic across all integrations + applies to every `sensitive: true`
 * field in the registry.
 */
describe('IntegrationConfigService — C2 masked round-trip', () => {
  function buildService(): {
    service: IntegrationConfigService;
    upsertMock: jest.Mock;
  } {
    const upsertMock = jest.fn().mockResolvedValue({});
    const prisma = {
      systemConfig: {
        upsert: upsertMock,
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const config = {
      get: jest.fn().mockReturnValue('a'.repeat(64)),
    } as unknown as ConfigService;
    const service = new IntegrationConfigService(prisma as never, config);
    return { service, upsertMock };
  }

  it('isMaskedValue detects bullet-prefixed masks', () => {
    const { service } = buildService();
    expect(service.isMaskedValue('••••abcd')).toBe(true);
    expect(service.isMaskedValue('••••')).toBe(true);
    expect(service.isMaskedValue('a••••b')).toBe(true);
    expect(service.isMaskedValue('hunter2')).toBe(false);
    expect(service.isMaskedValue('')).toBe(false);
    expect(service.isMaskedValue(null)).toBe(false);
    expect(service.isMaskedValue(undefined)).toBe(false);
  });

  it('skips SystemConfig write for sensitive field when value is masked', async () => {
    const { service, upsertMock } = buildService();

    // POST shape the ETaxConfigPage sends on save — mask hydrated from GET,
    // unchanged by user.
    await service.saveConfig('e-tax', {
      submitMode: 'enabled',
      certPath: '/secrets/etax-cert.pfx',
      certPassword: '••••f9a3',
      rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
      rdUsername: 'rd-user',
      rdPassword: '••••2bcd',
    });

    // Non-sensitive fields + sensitive fields with REAL values are written.
    // Sensitive fields whose value still contains the mask bullet are NOT.
    const writtenKeys = upsertMock.mock.calls.map(
      (call) => (call[0].where as { key: string }).key,
    );
    expect(writtenKeys).toContain('integration.e-tax.submitMode');
    expect(writtenKeys).toContain('integration.e-tax.certPath');
    expect(writtenKeys).toContain('integration.e-tax.rdEndpoint');
    expect(writtenKeys).toContain('integration.e-tax.rdUsername');
    // The two masked sensitive fields MUST NOT have been touched:
    expect(writtenKeys).not.toContain('integration.e-tax.certPassword');
    expect(writtenKeys).not.toContain('integration.e-tax.rdPassword');
  });

  it('writes sensitive field when user types a real new password', async () => {
    const { service, upsertMock } = buildService();

    await service.saveConfig('e-tax', {
      certPassword: 'brand-new-passphrase',
      rdPassword: '••••2bcd', // unchanged
    });

    const writtenKeys = upsertMock.mock.calls.map(
      (call) => (call[0].where as { key: string }).key,
    );
    expect(writtenKeys).toContain('integration.e-tax.certPassword');
    expect(writtenKeys).not.toContain('integration.e-tax.rdPassword');
  });
});
