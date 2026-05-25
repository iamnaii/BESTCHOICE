import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CannedResponseSenderService } from './canned-response-sender.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BubbleTranslatorService } from './bubble-translator.service';
import { CannedResponseVariableService } from './canned-response-variable.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';

describe('CannedResponseSenderService', () => {
  let service: CannedResponseSenderService;
  let prisma: any;
  let translator: any;
  let variableService: any;
  let messageRouter: any;

  // The sender service uses an ASCII SOH (U+0001) delimiter for its
  // single-shot variable-probe call. The variable-service mock returns the
  // probe string unchanged so the split-and-map step ends up with a
  // record of {key -> "{key}"}. Since none of the test bubbles include
  // `{name}` tokens, no actual substitution happens — the bubbles pass
  // through unmodified.
  beforeEach(async () => {
    prisma = {
      chatRoom: { findFirst: jest.fn() },
      cannedResponse: { findFirst: jest.fn() },
    };
    translator = {
      filterByChannel: jest.fn((bubbles: any[], channel: string) =>
        bubbles.filter(
          (b: any) => b.channels.length === 0 || b.channels.includes(channel),
        ),
      ),
      toOutboundMessage: jest.fn((bubble: any, externalUserId: string) => ({
        externalUserId,
        text: bubble.text ?? null,
        _bubbleId: bubble.id,
      })),
      translateQuickReplies: jest.fn((qrs: any[]) =>
        qrs.map((q: any) => ({
          label: q.label,
          type: q.type,
          payload: q.payload,
          url: q.url,
          message: q.message,
        })),
      ),
    };
    variableService = {
      // Identity: return the probe verbatim. The sender then splits on SOH
      // and builds a {key -> "{key}"} map; bubbles without `{name}` tokens
      // emerge unchanged.
      expandVariables: jest.fn(async (template: string) => template),
    };
    messageRouter = {
      sendStaffOutbound: jest.fn(async () => ({ success: true })),
    };

    const module = await Test.createTestingModule({
      providers: [
        CannedResponseSenderService,
        { provide: PrismaService, useValue: prisma },
        { provide: BubbleTranslatorService, useValue: translator },
        { provide: CannedResponseVariableService, useValue: variableService },
        { provide: MessageRouterService, useValue: messageRouter },
      ],
    }).compile();

    service = module.get(CannedResponseSenderService);
  });

  const makeBubble = (overrides: Partial<any>) => ({
    id: 'b1',
    type: 'TEXT',
    channels: [],
    text: null,
    mediaUrl: null,
    thumbnailUrl: null,
    stickerPackageId: null,
    stickerId: null,
    latitude: null,
    longitude: null,
    address: null,
    locationTitle: null,
    json: null,
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  });

  const baseRoom = {
    id: 'room-1',
    channel: 'LINE_FINANCE',
    externalUserId: 'U123',
    lineUserId: null,
    customerId: 'cust-1',
    verifiedAt: new Date('2026-01-01'),
  };

  it('happy path — sends each bubble, attaches quick replies to last only', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(baseRoom);
    prisma.cannedResponse.findFirst.mockResolvedValue({
      id: 'tpl-1',
      verifiedOnly: false,
      bubbles: [
        makeBubble({ id: 'b1', type: 'TEXT', text: 'สวัสดีครับ' }),
        makeBubble({ id: 'b2', type: 'TEXT', text: 'ยินดีให้บริการ' }),
      ],
      quickReplies: [
        { id: 'q1', label: 'ตกลง', type: 'POSTBACK', payload: 'OK', url: null, message: null },
      ],
    });

    const result = await service.send('room-1', 'tpl-1', 'staff-1');

    expect(messageRouter.sendStaffOutbound).toHaveBeenCalledTimes(2);

    // Verify quick replies attached to LAST outbound only
    const firstCall = messageRouter.sendStaffOutbound.mock.calls[0][1];
    const secondCall = messageRouter.sendStaffOutbound.mock.calls[1][1];
    expect(firstCall.quickReplies).toBeUndefined();
    expect(secondCall.quickReplies).toEqual([
      { label: 'ตกลง', type: 'POSTBACK', payload: 'OK', url: null, message: null },
    ]);

    // Verify dispatch args: roomId + outbound + staffId
    expect(messageRouter.sendStaffOutbound).toHaveBeenCalledWith(
      'room-1',
      expect.any(Object),
      'staff-1',
    );

    expect(result).toEqual({ sent: 2, dropped: 0, errors: [] });
  });

  it('throws NotFoundException when room not found', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(null);

    await expect(service.send('missing-room', 'tpl-1', 'staff-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.send('missing-room', 'tpl-1', 'staff-1')).rejects.toThrow(
      'ไม่พบห้องแชท',
    );
    expect(messageRouter.sendStaffOutbound).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when template not found', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(baseRoom);
    prisma.cannedResponse.findFirst.mockResolvedValue(null);

    await expect(service.send('room-1', 'missing-tpl', 'staff-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.send('room-1', 'missing-tpl', 'staff-1')).rejects.toThrow(
      'ไม่พบ template',
    );
    expect(messageRouter.sendStaffOutbound).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when verifiedOnly template + unverified room', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ ...baseRoom, verifiedAt: null });
    prisma.cannedResponse.findFirst.mockResolvedValue({
      id: 'tpl-1',
      verifiedOnly: true,
      bubbles: [makeBubble({ id: 'b1', type: 'TEXT', text: 'private content' })],
      quickReplies: [],
    });

    await expect(service.send('room-1', 'tpl-1', 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.send('room-1', 'tpl-1', 'staff-1')).rejects.toThrow(
      'ยืนยันตัวตน',
    );
    expect(messageRouter.sendStaffOutbound).not.toHaveBeenCalled();
  });

  it('channel filter — drops bubbles for other channels', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(baseRoom); // LINE_FINANCE
    prisma.cannedResponse.findFirst.mockResolvedValue({
      id: 'tpl-1',
      verifiedOnly: false,
      bubbles: [
        makeBubble({ id: 'universal', type: 'TEXT', text: 'all channels', channels: [] }),
        makeBubble({
          id: 'line-only',
          type: 'TEXT',
          text: 'line only',
          channels: ['LINE_FINANCE'],
        }),
        makeBubble({
          id: 'fb-only',
          type: 'TEXT',
          text: 'fb only',
          channels: ['FACEBOOK'],
        }),
      ],
      quickReplies: [],
    });

    const result = await service.send('room-1', 'tpl-1', 'staff-1');

    // Expect 2 of 3 bubbles dispatched (universal + line-only); FB excluded
    expect(messageRouter.sendStaffOutbound).toHaveBeenCalledTimes(2);
    const sentBubbleIds = messageRouter.sendStaffOutbound.mock.calls.map(
      (c: any[]) => c[1]._bubbleId,
    );
    expect(sentBubbleIds.sort()).toEqual(['line-only', 'universal']);
    expect(result).toEqual({ sent: 2, dropped: 0, errors: [] });
  });

  it('expandVariables is called exactly once regardless of bubble count (probe pattern)', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(baseRoom);
    prisma.cannedResponse.findFirst.mockResolvedValue({
      id: 'tpl-1',
      verifiedOnly: false,
      bubbles: [
        makeBubble({ id: 'b1', type: 'TEXT', text: 'first {customerName}' }),
        makeBubble({ id: 'b2', type: 'TEXT', text: 'second {contractNumber}' }),
        makeBubble({ id: 'b3', type: 'TEXT', text: 'third {amountDue}' }),
        makeBubble({ id: 'b4', type: 'TEXT', text: 'fourth {dueDate}' }),
      ],
      quickReplies: [],
    });

    await service.send('room-1', 'tpl-1', 'staff-1');

    // Single probe call regardless of how many TEXT bubbles exist — proves
    // the N+1 fix from W7 is intact
    expect(variableService.expandVariables).toHaveBeenCalledTimes(1);
    expect(messageRouter.sendStaffOutbound).toHaveBeenCalledTimes(4);
  });
});
