import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomNoteDto } from './create-room-note.dto';
const id = '11111111-1111-4111-8111-111111111111';
describe('Room note validation', () => {
  it.each([{ content: '' }, { content: ' '.repeat(10) }, { content: 'a'.repeat(5001) }, { content: 'ok', mentionedUserIds: ['name'] }, { content: 'ok', mentionedUserIds: [id,id] }, { content: 'ok', mentionedUserIds: null }, { content: 'ok', clientRequestId: 'no' }])('rejects malformed input %j', async input => {
    expect((await validate(plainToInstance(CreateRoomNoteDto,input))).length).toBeGreaterThan(0);
  });
  it('supports legacy content-only requests and explicit selected IDs', async () => {
    expect(await validate(plainToInstance(CreateRoomNoteDto, { content: ' @name ข้อความ ' }))).toEqual([]);
    const input = plainToInstance(CreateRoomNoteDto, { content: ' note ', mentionedUserIds: [id], clientRequestId: id });
    expect(await validate(input)).toEqual([]); expect(input.content).toBe('note');
  });
});
