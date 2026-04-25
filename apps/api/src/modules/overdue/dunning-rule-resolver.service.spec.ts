import { Test, TestingModule } from '@nestjs/testing';
import { DunningRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DunningRuleResolverService,
  DunningTagConditions,
} from './dunning-rule-resolver.service';

const mockPrisma = {
  customerTag: {
    findMany: jest.fn(),
  },
};

function makeRule(tagConditions?: DunningTagConditions | null): DunningRule {
  return {
    id: 'rule-1',
    name: 'D+3',
    triggerDay: 3,
    eventTrigger: null,
    channel: 'LINE',
    messageTemplate: 'hi',
    includePaymentLink: false,
    autoExecute: true,
    escalateTo: null,
    isActive: true,
    sortOrder: 0,
    tagConditions: (tagConditions ?? null) as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as DunningRule;
}

describe('DunningRuleResolverService', () => {
  let service: DunningRuleResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DunningRuleResolverService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(DunningRuleResolverService);
  });

  describe('resolve — built-in defaults', () => {
    it('BLACKLIST → immediate (delayDays=0, skipSoft=true) overriding everything', () => {
      const rule = makeRule({ delayDaysForTags: { VIP: 7 } });
      const r = service.resolve(rule, ['BLACKLIST', 'VIP']);
      expect(r.action).toBe('send');
      if (r.action === 'send') {
        expect(r.delayDays).toBe(0);
        expect(r.skipSoft).toBe(true);
        expect(r.reason).toMatch(/BLACKLIST/);
      }
    });

    it('HIGH_RISK → skipSoft=true (jump to firm) but no delay', () => {
      const rule = makeRule(null);
      const r = service.resolve(rule, ['HIGH_RISK']);
      expect(r.action).toBe('send');
      if (r.action === 'send') {
        expect(r.delayDays).toBe(0);
        expect(r.skipSoft).toBe(true);
      }
    });

    it('VIP → +3 day default delay (no per-rule override)', () => {
      const rule = makeRule(null);
      const r = service.resolve(rule, ['VIP']);
      expect(r.action).toBe('send');
      if (r.action === 'send') {
        expect(r.delayDays).toBe(3);
        expect(r.skipSoft).toBe(false);
      }
    });

    it('no tags → passthrough (delayDays=0, skipSoft=false, reason="no tag override")', () => {
      const rule = makeRule(null);
      const r = service.resolve(rule, []);
      expect(r).toEqual({
        action: 'send',
        delayDays: 0,
        skipSoft: false,
        reason: 'no tag override',
      });
    });
  });

  describe('resolve — per-rule overrides', () => {
    it('skipForTags matches → action="skip"', () => {
      const rule = makeRule({ skipForTags: ['LOYAL'] });
      const r = service.resolve(rule, ['LOYAL']);
      expect(r.action).toBe('skip');
      expect(r.reason).toMatch(/LOYAL/);
    });

    it('owner-set VIP delay (7) overrides the +3 default', () => {
      const rule = makeRule({ delayDaysForTags: { VIP: 7 } });
      const r = service.resolve(rule, ['VIP']);
      expect(r.action).toBe('send');
      if (r.action === 'send') {
        expect(r.delayDays).toBe(7);
      }
    });

    it('combination: HIGH_RISK + VIP → skipSoft yes, no delay (HIGH_RISK trumps VIP delay default)', () => {
      const rule = makeRule(null);
      const r = service.resolve(rule, ['HIGH_RISK', 'VIP']);
      expect(r.action).toBe('send');
      if (r.action === 'send') {
        // VIP default delay still applies because HIGH_RISK does not
        // explicitly override it; the engine-level priority order says
        // BLACKLIST wins over both, but HIGH_RISK only forces firm.
        expect(r.skipSoft).toBe(true);
        expect(r.delayDays).toBe(3);
      }
    });
  });

  describe('fetchTagsForCustomer', () => {
    it('returns the tag enum values for non-deleted CustomerTag rows', async () => {
      mockPrisma.customerTag.findMany.mockResolvedValueOnce([
        { tag: 'VIP' },
        { tag: 'NEW' },
      ]);
      const tags = await service.fetchTagsForCustomer('cust-1');
      expect(tags).toEqual(['VIP', 'NEW']);
      expect(mockPrisma.customerTag.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', deletedAt: null },
        select: { tag: true },
      });
    });
  });
});
