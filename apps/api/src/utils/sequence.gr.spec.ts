import { generateGRNumber } from './sequence.util';

describe('generateGRNumber', () => {
  it('formats GR-YYYY-MM-NNN using the monthly count + 1', async () => {
    const tx = { goodsReceiving: { count: jest.fn().mockResolvedValue(4) } };
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gr = await generateGRNumber(tx as any);
    expect(gr).toBe(`GR-${yyyy}-${mm}-005`);
    expect(tx.goodsReceiving.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
  });

  it('starts at 001 when there are no receivings this month', async () => {
    const tx = { goodsReceiving: { count: jest.fn().mockResolvedValue(0) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gr = await generateGRNumber(tx as any);
    expect(gr.endsWith('-001')).toBe(true);
  });
});
