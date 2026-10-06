import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChatFollowUpDto, UpdateChatFollowUpDto } from './chat-follow-up.dto';
describe('Follow-up request validation', () => {
  it.each([{ expectedRevision: 0, dueAt: null }, { expectedRevision: 0, assigneeId: null }, { expectedRevision: -1 }, { expectedRevision: 0, dueAt: '2026-10-06T10:00:00' }, { expectedRevision: 0, status: 'PURCHASED' }])('rejects invalid patch %j', async input => {
    expect((await validate(plainToInstance(UpdateChatFollowUpDto, input))).length).toBeGreaterThan(0);
  });
  it('accepts a trimmed title and a Bangkok offset and rejects an invalid calendar date', async () => {
    const valid = { clientRequestId: '11111111-1111-4111-8111-111111111111', assigneeId: '22222222-2222-4222-8222-222222222222', title: ' โทรตาม ', dueAt: '2026-10-06T10:00:00+07:00' };
    const dto = plainToInstance(CreateChatFollowUpDto, valid);
    expect(await validate(dto)).toEqual([]); expect(dto.title).toBe('โทรตาม');
    expect((await validate(plainToInstance(CreateChatFollowUpDto, { ...valid, dueAt: '2026-02-30T10:00:00+07:00' }))).length).toBeGreaterThan(0);
  });
});
