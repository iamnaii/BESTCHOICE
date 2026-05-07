import { buildContractSignedFlex, ContractSignedData } from './contract-signed.flex';
import { FlexBubble } from './base-template';

describe('buildContractSignedFlex', () => {
  const baseData: ContractSignedData = {
    customerName: 'สมชาย ใจดี',
    contractNumber: 'BC-2026-001',
    productName: 'iPhone 16 Pro Max 256GB',
    totalMonths: 12,
    monthlyPayment: 2500,
    signedAt: '17 มี.ค. 2569',
  };

  it('should return a valid flex message payload', () => {
    const result = buildContractSignedFlex(baseData);

    expect(result).toBeDefined();
    expect(result.type).toBe('flex');
    expect(result.altText).toContain('BC-2026-001');
  });

  it('should include contract number in altText', () => {
    const result = buildContractSignedFlex(baseData);
    expect(result.altText).toBe('เซ็นสัญญา BC-2026-001 เรียบร้อย');
  });

  it('should have bubble type contents', () => {
    const result = buildContractSignedFlex(baseData);
    const bubble = result.contents as FlexBubble;
    expect(bubble.type).toBe('bubble');
    expect(bubble.size).toBe('mega');
  });

  it('should include footer with download button when downloadUrl is provided', () => {
    const data = { ...baseData, downloadUrl: 'https://example.com/download' };
    const result = buildContractSignedFlex(data);
    const bubble = result.contents as FlexBubble;

    expect(bubble.footer).toBeDefined();
    expect(bubble.footer!.contents.length).toBeGreaterThanOrEqual(1);
    expect(bubble.footer!.contents[0]).toMatchObject({
      type: 'button',
    });
  });

  it('should not have footer when downloadUrl is not provided', () => {
    const result = buildContractSignedFlex(baseData);
    const bubble = result.contents as FlexBubble;
    expect(bubble.footer).toBeUndefined();
  });

  it('should have body section with contents', () => {
    const result = buildContractSignedFlex(baseData);
    const bubble = result.contents as FlexBubble;

    expect(bubble.body).toBeDefined();
    expect(bubble.body!.contents.length).toBeGreaterThan(0);
  });
});
