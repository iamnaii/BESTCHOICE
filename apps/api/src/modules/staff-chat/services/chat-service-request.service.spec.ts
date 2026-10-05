import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  CreateChatServiceRequestDto,
  UpdateChatServiceRequestDto,
} from '../dto/chat-service-request.dto';
describe('Service intake HTTP contract', () => {
  const draft = () => ({
    clientRequestId: randomUUID(),
    symptom: '  หน้าจอไม่ตอบสนอง  ',
    assigneeId: randomUUID(),
    dueAt: '2026-10-07T10:00:00+07:00',
    sourceMessageIds: [randomUUID()],
  });
  it('trims symptom and requires explicit timezone, finite evidence set and explicit status', async () => {
    const valid = plainToInstance(CreateChatServiceRequestDto, draft());
    expect(valid.symptom).toBe('หน้าจอไม่ตอบสนอง');
    expect(await validate(valid)).toEqual([]);
    for (const patch of [
      { symptom: ' สั้น ' },
      { dueAt: '2026-10-07T10:00:00' },
      { sourceMessageIds: Array.from({ length: 11 }, () => randomUUID()) },
      { sourceMessageIds: ['invalid'] },
      { assigneeId: null },
    ])
      expect(
        (await validate(plainToInstance(CreateChatServiceRequestDto, { ...draft(), ...patch })))
          .length,
      ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateChatServiceRequestDto, { expectedRevision: 0, status: 'LINKED' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects negative revision, null assignment and timezone-free rescheduling', async () => {
    for (const patch of [
      { expectedRevision: -1 },
      { assigneeId: null },
      { dueAt: '2026-10-07T10:00:00' },
    ])
      expect(
        (
          await validate(
            plainToInstance(UpdateChatServiceRequestDto, { expectedRevision: 0, ...patch }),
          )
        ).length,
      ).toBeGreaterThan(0);
  });
});
