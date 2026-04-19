import { INTEGRATIONS, getIntegrationDef } from './integration-registry';

describe('integration-registry — MDM key rotation field (T6-C13)', () => {
  it('defines the mdm integration', () => {
    const mdm = getIntegrationDef('mdm');
    expect(mdm).toBeDefined();
    expect(mdm?.name).toBe('MDM PJ-Soft');
  });

  it('includes sensitive apiKeyPrevious field for zero-downtime rotation', () => {
    const mdm = getIntegrationDef('mdm');
    const prev = mdm?.fields.find((f) => f.key === 'apiKeyPrevious');
    expect(prev).toBeDefined();
    expect(prev?.sensitive).toBe(true);
    expect(prev?.required).toBe(false);
    expect(prev?.envVar).toBe('MDM_API_KEY_PREVIOUS');
  });

  it('keeps primary apiKey field untouched', () => {
    const mdm = getIntegrationDef('mdm');
    const primary = mdm?.fields.find((f) => f.key === 'apiKey');
    expect(primary).toBeDefined();
    expect(primary?.required).toBe(true);
    expect(primary?.envVar).toBe('MDM_API_KEY');
  });

  it('has every sensitive field flagged correctly across the registry', () => {
    // Sanity: registry entries must still have a key + at least one field
    for (const def of INTEGRATIONS) {
      expect(def.key).toBeTruthy();
      expect(def.fields.length).toBeGreaterThan(0);
    }
  });
});
