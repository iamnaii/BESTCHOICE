import { HandoffService } from './handoff.service';

describe('HandoffService.isBotSilenced', () => {
  const make = (room: { handoffMode: boolean; aiPaused: boolean } | null) => {
    const prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue(room) },
    };
    return new HandoffService(prisma as any, {} as any);
  };

  it('returns true when room is in handoff mode', async () => {
    expect(await make({ handoffMode: true, aiPaused: false }).isBotSilenced('r1')).toBe(true);
  });

  it('returns true when staff took over (aiPaused)', async () => {
    expect(await make({ handoffMode: false, aiPaused: true }).isBotSilenced('r1')).toBe(true);
  });

  it('returns false when neither flag is set', async () => {
    expect(await make({ handoffMode: false, aiPaused: false }).isBotSilenced('r1')).toBe(false);
  });

  it('returns false when room does not exist', async () => {
    expect(await make(null).isBotSilenced('r1')).toBe(false);
  });
});
