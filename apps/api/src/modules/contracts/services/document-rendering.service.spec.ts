import { DocumentRenderingService } from './document-rendering.service';

describe('contract device disclosure', () => {
  const service = new DocumentRenderingService({} as never, {} as never, { findAll: async () => [{ key: 'contract_warranty_days', value: '90' }] } as never);
  const contract = { createdAt: new Date('2026-09-01'), totalMonths: 0, product: { deviceOrigin: 'THAI', shopWarrantyDays: 90, warrantyTerms: 'Changed' } };
  it('renders captured terms safely even after product edits', async () => {
    const html = await service.replacePlaceholders('<html><body>{{CONTRACT.WARRANTY_DAYS}}</body></html>', {
      ...contract, productDisclosure: { version: 1, deviceOrigin: 'IMPORTED', shopWarrantyDays: 0, warrantyTerms: '<script>old</script>\nOriginal warranty' },
    });
    expect(html).toContain('เครื่องนอก');
    expect(html).toContain('ไม่มีประกันร้าน');
    expect(html).toContain('&lt;script&gt;old&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Changed');
  });
  it('does not invent historic terms for legacy contracts', async () => {
    const html = await service.replacePlaceholders('<body>Legacy</body>', contract);
    expect(html).toBe('<body>Legacy</body>');
  });
});
