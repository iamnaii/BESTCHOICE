import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JourneyListQueryDto } from './journey-list-query.dto';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(JourneyListQueryDto, plain, { enableImplicitConversion: true });
  return { dto, fields: (await validate(dto, { whitelist: true })).map((e) => e.property) };
};

describe('JourneyListQueryDto', () => {
  it('ค่าตั้งต้น limit 30 · groups และ include รับ csv และ key ซ้ำ', async () => {
    expect(await check({})).toMatchObject({ dto: { limit: 30 }, fields: [] });
    expect(await check({ groups: 'chat, credit', limit: '10' })).toMatchObject({ dto: { groups: ['chat', 'credit'], limit: 10 }, fields: [] });
    expect((await check({ groups: ['chat', 'sale,points'] })).dto.groups).toEqual(['chat', 'sale', 'points']);
    expect(await check({ include: 'counts' })).toMatchObject({ dto: { include: ['counts'] }, fields: [] });
    expect(await check({ include: ['summary', 'counts'] })).toMatchObject({ dto: { include: ['summary', 'counts'] }, fields: [] });
  });
  it.each([
    [{ groups: 'chat,messages' }, 'groups'], [{ limit: '0' }, 'limit'], [{ limit: '101' }, 'limit'],
    [{ cursor: 'ไม่ใช่ cursor' }, 'cursor'], [{ from: 'เมื่อวาน' }, 'from'], [{ include: 'counts,events' }, 'include'],
  ])('%j → error ที่ %s', async (plain, field) => {
    expect((await check(plain)).fields).toEqual([field]);
  });
});
