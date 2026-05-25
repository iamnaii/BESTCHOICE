import { Test } from '@nestjs/testing';
import { QuickReplyPostbackRouterService } from './quick-reply-postback-router.service';
import { CannedResponseSenderService } from './canned-response-sender.service';

describe('QuickReplyPostbackRouterService', () => {
  let service: QuickReplyPostbackRouterService;
  let sender: { send: jest.Mock };

  beforeEach(async () => {
    sender = {
      send: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        QuickReplyPostbackRouterService,
        { provide: CannedResponseSenderService, useValue: sender },
      ],
    }).compile();
    service = module.get(QuickReplyPostbackRouterService);
  });

  describe('route()', () => {
    it('handles TEMPLATE:<id> payload — calls sender.send with null staffId', async () => {
      sender.send.mockResolvedValue({ sent: 2, dropped: 0, errors: [] });

      const result = await service.route('room-123', 'TEMPLATE:abc-123');

      expect(sender.send).toHaveBeenCalledWith('room-123', 'abc-123', null);
      expect(result).toEqual({
        handled: true,
        action: 'send-template',
        templateId: 'abc-123',
      });
    });

    it('handles TEMPLATE: with empty id — returns handled with error, does NOT call sender', async () => {
      const result = await service.route('room-123', 'TEMPLATE:');

      expect(sender.send).not.toHaveBeenCalled();
      expect(result.handled).toBe(true);
      expect(result.action).toBe('unknown');
      expect(result.error).toMatch(/missing id/i);
    });

    it('returns handled:false for unknown formats — caller falls through', async () => {
      const result = await service.route('room-123', 'action=check_balance');

      expect(sender.send).not.toHaveBeenCalled();
      expect(result).toEqual({ handled: false });
    });

    it('returns handled:false for empty / non-string payload', async () => {
      expect(await service.route('room-1', '')).toEqual({ handled: false });
      expect(await service.route('room-1', null as unknown as string)).toEqual({
        handled: false,
      });
      expect(await service.route('room-1', undefined as unknown as string)).toEqual({
        handled: false,
      });
    });

    it('marks handled:true with error message when sender.send throws', async () => {
      sender.send.mockRejectedValue(new Error('ไม่พบ template'));

      const result = await service.route('room-123', 'TEMPLATE:missing-template');

      expect(sender.send).toHaveBeenCalledWith('room-123', 'missing-template', null);
      expect(result).toEqual({
        handled: true,
        action: 'send-template',
        templateId: 'missing-template',
        error: 'ไม่พบ template',
      });
    });

    it('trims whitespace inside TEMPLATE:<id> payload', async () => {
      sender.send.mockResolvedValue({ sent: 1, dropped: 0, errors: [] });

      const result = await service.route('room-x', 'TEMPLATE:  spaced-id  ');

      expect(sender.send).toHaveBeenCalledWith('room-x', 'spaced-id', null);
      expect(result.templateId).toBe('spaced-id');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // W7: Postback loop guard — rate-limit per-room postback dispatches
  // ──────────────────────────────────────────────────────────────────────────

  describe('postback loop guard (W7)', () => {
    it('rate-limits after 5 postback dispatches within 10s from same room', async () => {
      sender.send.mockResolvedValue({ sent: 1, dropped: 0, errors: [] });

      // First 5 sends pass through normally
      for (let i = 0; i < 5; i++) {
        const r = await service.route('room-loopy', `TEMPLATE:tpl-${i}`);
        expect(r.handled).toBe(true);
        expect(r.error).toBeUndefined();
      }
      expect(sender.send).toHaveBeenCalledTimes(5);

      // 6th send in the same window is rate-limited — handled but not dispatched
      const sixth = await service.route('room-loopy', 'TEMPLATE:tpl-6');
      expect(sixth.handled).toBe(true);
      expect(sixth.error).toMatch(/rate-limited/i);
      expect(sender.send).toHaveBeenCalledTimes(5); // sender NOT called the 6th time
    });

    it('rate limit is per-room — different rooms are not affected', async () => {
      sender.send.mockResolvedValue({ sent: 1, dropped: 0, errors: [] });

      // Saturate room-A
      for (let i = 0; i < 5; i++) {
        await service.route('room-A', `TEMPLATE:tpl-${i}`);
      }
      const sixthA = await service.route('room-A', 'TEMPLATE:tpl-X');
      expect(sixthA.error).toMatch(/rate-limited/i);

      // room-B still works fine
      const firstB = await service.route('room-B', 'TEMPLATE:tpl-Y');
      expect(firstB.handled).toBe(true);
      expect(firstB.error).toBeUndefined();
    });

    it('rate limit window expires — old timestamps drop out (uses fake timers)', async () => {
      sender.send.mockResolvedValue({ sent: 1, dropped: 0, errors: [] });
      jest.useFakeTimers().setSystemTime(new Date('2026-05-24T10:00:00Z'));

      try {
        // 5 calls at t=0
        for (let i = 0; i < 5; i++) {
          await service.route('room-window', `TEMPLATE:tpl-${i}`);
        }

        // 6th call at t=0 → blocked
        const blocked = await service.route('room-window', 'TEMPLATE:tpl-6');
        expect(blocked.error).toMatch(/rate-limited/i);

        // Advance past the 10s window → old timestamps prune, new send allowed
        jest.setSystemTime(new Date('2026-05-24T10:00:11Z'));
        const after = await service.route('room-window', 'TEMPLATE:tpl-7');
        expect(after.handled).toBe(true);
        expect(after.error).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it('non-TEMPLATE payloads do NOT count toward rate limit (fall through)', async () => {
      sender.send.mockResolvedValue({ sent: 1, dropped: 0, errors: [] });

      // 100 unknown-payload calls — all fall through, none touch the counter
      for (let i = 0; i < 100; i++) {
        const r = await service.route('room-unrelated', `action=foo-${i}`);
        expect(r).toEqual({ handled: false });
      }

      // First 5 TEMPLATE: payloads still succeed (counter not poisoned)
      for (let i = 0; i < 5; i++) {
        const r = await service.route('room-unrelated', `TEMPLATE:tpl-${i}`);
        expect(r.error).toBeUndefined();
      }
    });
  });
});
