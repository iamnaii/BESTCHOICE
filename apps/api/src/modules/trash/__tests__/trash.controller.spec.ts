import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrashController } from '../trash.controller';
import { ListTrashDto, RestoreTrashDto, TrashTypesDto } from '../dto/trash.dto';

/** ก้อน 8 A10 — endpoints OWNER เท่านั้น + DTO (สเปก §3, §6) */
describe('TrashController', () => {
  const service = { listTypes: jest.fn().mockResolvedValue([]), list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50, capped: false }), restore: jest.fn().mockResolvedValue({ ok: true, warnings: [] }), restoreMany: jest.fn().mockResolvedValue({ results: [] }) };
  const controller = new TrashController(service as never);
  const user = { id: 'u-owner', role: 'OWNER' };

  it('CT1 every handler is OWNER-only', () => {
    for (const handler of ['types', 'list', 'restore', 'restoreMany'] as const) {
      expect(Reflect.getMetadata('roles', TrashController.prototype[handler])).toEqual(['OWNER']);
    }
  });

  it('CT2 GET /trash passes the parsed query through (days default 90)', async () => {
    const dto = plainToInstance(ListTrashDto, { type: 'customer', q: 'สม', page: '2', pageSize: '25' });
    expect(await validate(dto)).toEqual([]);
    await controller.list(dto);
    expect(service.list).toHaveBeenCalledWith({ type: 'customer', q: 'สม', days: 90, page: 2, pageSize: 25 });
    await controller.types(plainToInstance(TrashTypesDto, { days: '0' }));
    expect(service.listTypes).toHaveBeenCalledWith(0);
  });

  it('CT3 DTO validation: days ∈ {0,30,90}, pageSize ≤ 100, bulk ≤ 50 items with type+id', async () => {
    expect((await validate(plainToInstance(ListTrashDto, { days: '7' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ListTrashDto, { pageSize: '500' }))).length).toBeGreaterThan(0);
    const tooMany = plainToInstance(RestoreTrashDto, { items: Array.from({ length: 51 }, (_, i) => ({ type: 'promotion', id: `p${i}` })) });
    expect((await validate(tooMany)).length).toBeGreaterThan(0);
    const bad = plainToInstance(RestoreTrashDto, { items: [{ type: 'promotion' }] });
    expect((await validate(bad)).length).toBeGreaterThan(0);
    const ok = plainToInstance(RestoreTrashDto, { items: [{ type: 'promotion', id: 'p1' }] });
    expect(await validate(ok)).toEqual([]);
  });

  it('CT4 restore handlers forward the acting user', async () => {
    await controller.restore('promotion', 'p1', user as never);
    expect(service.restore).toHaveBeenCalledWith('promotion', 'p1', user);
    await controller.restoreMany(plainToInstance(RestoreTrashDto, { items: [{ type: 'promotion', id: 'p1' }] }), user as never);
    expect(service.restoreMany).toHaveBeenCalledWith([{ type: 'promotion', id: 'p1' }], user);
  });
});
