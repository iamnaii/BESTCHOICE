import { Test } from '@nestjs/testing';
import { PersonaService } from './persona.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SHOP_SALES_PERSONA_BASE,
  SHOP_SALES_PERSONA_BOT_EXTRAS,
} from '../prompts/sales-persona';

/**
 * Build a PersonaService with a mock prisma whose `findFirst` returns the
 * given override for either key (BASE / EXTRAS), and whose `findMany` is
 * derived from those overrides for `isCustomized` tests.
 */
function build(overrides: { base?: string | null; extras?: string | null }) {
  const findFirst = jest.fn(async ({ where }: any) => {
    const key = where.key as string;
    const val = key === 'shop_bot_persona_base' ? overrides.base : overrides.extras;
    return val == null ? null : { value: val };
  });
  const findMany = jest.fn(async ({ where }: any) => {
    const keys = where.key.in as string[];
    const rows: { key: string; value: string }[] = [];
    if (keys.includes('shop_bot_persona_base') && overrides.base != null) {
      rows.push({ key: 'shop_bot_persona_base', value: overrides.base });
    }
    if (keys.includes('shop_bot_persona_bot_extras') && overrides.extras != null) {
      rows.push({ key: 'shop_bot_persona_bot_extras', value: overrides.extras });
    }
    return rows;
  });
  const prisma = { systemConfig: { findFirst, findMany } };
  return Test.createTestingModule({
    providers: [
      PersonaService,
      { provide: PrismaService, useValue: prisma },
    ],
  })
    .compile()
    .then((mod) => ({ svc: mod.get(PersonaService), prisma }));
}

describe('PersonaService', () => {
  describe('getBase / getBotExtras / getBot — defaults', () => {
    it('falls back to hardcoded BASE when row absent', async () => {
      const { svc } = await build({ base: null, extras: null });
      expect(await svc.getBase()).toBe(SHOP_SALES_PERSONA_BASE);
    });

    it('falls back to hardcoded BOT_EXTRAS when row absent', async () => {
      const { svc } = await build({ base: null, extras: null });
      expect(await svc.getBotExtras()).toBe(SHOP_SALES_PERSONA_BOT_EXTRAS);
    });

    it('getBot composes default BASE + default EXTRAS when both absent', async () => {
      const { svc } = await build({ base: null, extras: null });
      expect(await svc.getBot()).toBe(
        `${SHOP_SALES_PERSONA_BASE}${SHOP_SALES_PERSONA_BOT_EXTRAS}`,
      );
    });

    it.each(['', '   ', '\n\t  '])(
      'treats whitespace-only "%s" as no override',
      async (whitespace) => {
        const { svc } = await build({ base: whitespace, extras: null });
        expect(await svc.getBase()).toBe(SHOP_SALES_PERSONA_BASE);
      },
    );
  });

  describe('getBase / getBotExtras / getBot — owner overrides', () => {
    it('returns owner-edited BASE when SystemConfig row present', async () => {
      const customBase = 'คุณคือแอดมินใหม่ — สั้น กระชับ';
      const { svc } = await build({ base: customBase, extras: null });
      expect(await svc.getBase()).toBe(customBase);
    });

    it('returns owner-edited EXTRAS when present', async () => {
      const customExtras = '\n\n# my custom playbook';
      const { svc } = await build({ base: null, extras: customExtras });
      expect(await svc.getBotExtras()).toBe(customExtras);
    });

    it('getBot composes owner BASE + owner EXTRAS', async () => {
      const customBase = 'BASE override';
      const customExtras = '\n\nEXTRAS override';
      const { svc } = await build({ base: customBase, extras: customExtras });
      expect(await svc.getBot()).toBe(`${customBase}${customExtras}`);
    });

    it('getBot composes owner BASE + default EXTRAS when EXTRAS not overridden', async () => {
      const customBase = 'BASE override only';
      const { svc } = await build({ base: customBase, extras: null });
      expect(await svc.getBot()).toBe(`${customBase}${SHOP_SALES_PERSONA_BOT_EXTRAS}`);
    });
  });

  describe('caching', () => {
    it('caches each field separately — second call within TTL no DB hit', async () => {
      const { svc, prisma } = await build({ base: 'b', extras: 'e' });
      await svc.getBase();
      await svc.getBase();
      await svc.getBotExtras();
      await svc.getBotExtras();
      // 1 call per distinct key
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(2);
    });

    it('invalidateCache() drops both snapshots', async () => {
      const { svc, prisma } = await build({ base: 'b', extras: 'e' });
      await svc.getBase();
      await svc.getBotExtras();
      svc.invalidateCache();
      await svc.getBase();
      await svc.getBotExtras();
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(4);
    });

    it('invalidateCache() is idempotent', async () => {
      const { svc } = await build({ base: 'b', extras: 'e' });
      expect(() => svc.invalidateCache()).not.toThrow();
      expect(() => svc.invalidateCache()).not.toThrow();
      expect(await svc.getBase()).toBe('b');
    });

    it('falls back to hardcoded on DB error', async () => {
      const prisma = {
        systemConfig: {
          findFirst: jest.fn().mockRejectedValue(new Error('connection refused')),
          findMany: jest.fn().mockRejectedValue(new Error('connection refused')),
        },
      };
      const mod = await Test.createTestingModule({
        providers: [
          PersonaService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const svc = mod.get(PersonaService);
      expect(await svc.getBase()).toBe(SHOP_SALES_PERSONA_BASE);
      expect(await svc.getBotExtras()).toBe(SHOP_SALES_PERSONA_BOT_EXTRAS);
    });
  });

  describe('isCustomized', () => {
    it('returns false/false when neither row present', async () => {
      const { svc } = await build({ base: null, extras: null });
      expect(await svc.isCustomized()).toEqual({ base: false, extras: false });
    });

    it('returns true/false when only BASE overridden', async () => {
      const { svc } = await build({ base: 'custom', extras: null });
      expect(await svc.isCustomized()).toEqual({ base: true, extras: false });
    });

    it('returns false/true when only EXTRAS overridden', async () => {
      const { svc } = await build({ base: null, extras: 'custom' });
      expect(await svc.isCustomized()).toEqual({ base: false, extras: true });
    });

    it('returns true/true when both overridden', async () => {
      const { svc } = await build({ base: 'b', extras: 'e' });
      expect(await svc.isCustomized()).toEqual({ base: true, extras: true });
    });

    it('treats empty-string rows as not customized', async () => {
      const { svc } = await build({ base: '', extras: '   ' });
      expect(await svc.isCustomized()).toEqual({ base: false, extras: false });
    });

    it('returns false/false on DB error', async () => {
      const prisma = {
        systemConfig: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockRejectedValue(new Error('boom')),
        },
      };
      const mod = await Test.createTestingModule({
        providers: [
          PersonaService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const svc = mod.get(PersonaService);
      expect(await svc.isCustomized()).toEqual({ base: false, extras: false });
    });
  });
});
