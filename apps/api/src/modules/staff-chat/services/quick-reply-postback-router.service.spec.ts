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
});
