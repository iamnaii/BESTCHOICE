import {
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  readJsonFlag,
} from './config.util';

/**
 * Stub SystemConfig reader. Maps key → value (string|null) for unit testing
 * without spinning up a real Prisma instance. `throwsOn` simulates DB errors
 * for defensive-fallback assertions.
 */
function makeStub(store: Record<string, string | null>, throwsOn?: string) {
  return {
    systemConfig: {
      findFirst: async (args: { where: { key: string } }) => {
        const key = args.where.key;
        if (throwsOn && key === throwsOn) {
          throw new Error('simulated db error');
        }
        if (!(key in store)) return null;
        const value = store[key];
        return value === null ? { value: null } : { value };
      },
    },
  };
}

describe('config.util — SystemConfig flag readers', () => {
  describe('readBoolFlag', () => {
    it('returns fallback when key missing', async () => {
      const stub = makeStub({});
      expect(await readBoolFlag(stub, 'missing', true)).toBe(true);
      expect(await readBoolFlag(stub, 'missing', false)).toBe(false);
    });

    it('parses true/false (case-insensitive) + 1/0', async () => {
      const stub = makeStub({
        a: 'true',
        b: 'TRUE',
        c: '1',
        d: 'false',
        e: 'FALSE',
        f: '0',
      });
      expect(await readBoolFlag(stub, 'a', false)).toBe(true);
      expect(await readBoolFlag(stub, 'b', false)).toBe(true);
      expect(await readBoolFlag(stub, 'c', false)).toBe(true);
      expect(await readBoolFlag(stub, 'd', true)).toBe(false);
      expect(await readBoolFlag(stub, 'e', true)).toBe(false);
      expect(await readBoolFlag(stub, 'f', true)).toBe(false);
    });

    it('returns fallback on unparseable value', async () => {
      const stub = makeStub({ x: 'maybe', y: 'yes', z: '   ' });
      expect(await readBoolFlag(stub, 'x', true)).toBe(true);
      expect(await readBoolFlag(stub, 'y', false)).toBe(false);
      expect(await readBoolFlag(stub, 'z', true)).toBe(true);
    });

    it('swallows DB errors and returns fallback', async () => {
      const stub = makeStub({}, 'boom');
      expect(await readBoolFlag(stub, 'boom', true)).toBe(true);
      expect(await readBoolFlag(stub, 'boom', false)).toBe(false);
    });
  });

  describe('readNumberFlag', () => {
    it('returns fallback when key missing', async () => {
      const stub = makeStub({});
      expect(await readNumberFlag(stub, 'missing', 42)).toBe(42);
    });

    it('parses integers, decimals, and negatives', async () => {
      const stub = makeStub({ a: '100', b: '3.14', c: '-7', d: '  12  ' });
      expect(await readNumberFlag(stub, 'a', 0)).toBe(100);
      expect(await readNumberFlag(stub, 'b', 0)).toBe(3.14);
      expect(await readNumberFlag(stub, 'c', 0)).toBe(-7);
      expect(await readNumberFlag(stub, 'd', 0)).toBe(12);
    });

    it('returns fallback on NaN/Infinity/unparseable', async () => {
      const stub = makeStub({ a: 'not-a-number', b: 'Infinity', c: '' });
      expect(await readNumberFlag(stub, 'a', 99)).toBe(99);
      // Infinity is a finite number per Number.isFinite — explicitly NOT finite
      expect(await readNumberFlag(stub, 'b', 99)).toBe(99);
      expect(await readNumberFlag(stub, 'c', 99)).toBe(99);
    });

    it('swallows DB errors and returns fallback', async () => {
      const stub = makeStub({}, 'boom');
      expect(await readNumberFlag(stub, 'boom', 5)).toBe(5);
    });
  });

  describe('readStringFlag', () => {
    it('returns fallback when key missing or empty', async () => {
      const stub = makeStub({ empty: '', whitespace: '   ' });
      expect(await readStringFlag(stub, 'missing', 'default')).toBe('default');
      expect(await readStringFlag(stub, 'empty', 'default')).toBe('default');
      expect(await readStringFlag(stub, 'whitespace', 'default')).toBe('default');
    });

    it('returns trimmed value when present', async () => {
      const stub = makeStub({ name: '  KBank  ', plain: 'SCB' });
      expect(await readStringFlag(stub, 'name', 'fallback')).toBe('KBank');
      expect(await readStringFlag(stub, 'plain', 'fallback')).toBe('SCB');
    });
  });

  describe('readJsonFlag', () => {
    type Reason = { code: string; label: string };
    const isReasonArray = (v: unknown): v is Reason[] =>
      Array.isArray(v) &&
      v.every(
        (r) =>
          r != null &&
          typeof r === 'object' &&
          typeof (r as Reason).code === 'string' &&
          typeof (r as Reason).label === 'string',
      );

    const defaults: Reason[] = [{ code: 'other', label: 'อื่นๆ' }];

    it('returns fallback when key missing', async () => {
      const stub = makeStub({});
      expect(await readJsonFlag(stub, 'missing', defaults, isReasonArray)).toEqual(defaults);
    });

    it('returns parsed value when JSON is valid + validator passes', async () => {
      const stub = makeStub({
        list: JSON.stringify([{ code: 'wrong_amount', label: 'ผิดยอด' }]),
      });
      const result = await readJsonFlag<Reason[]>(stub, 'list', defaults, isReasonArray);
      expect(result).toEqual([{ code: 'wrong_amount', label: 'ผิดยอด' }]);
    });

    it('returns fallback when validator rejects shape', async () => {
      const stub = makeStub({
        list: JSON.stringify([{ code: 'x', label: 42 }]), // label not string
      });
      const result = await readJsonFlag<Reason[]>(stub, 'list', defaults, isReasonArray);
      expect(result).toEqual(defaults);
    });

    it('returns fallback on malformed JSON', async () => {
      const stub = makeStub({ list: '{not json' });
      const result = await readJsonFlag<Reason[]>(stub, 'list', defaults, isReasonArray);
      expect(result).toEqual(defaults);
    });

    it('works without validator (trust caller)', async () => {
      const stub = makeStub({ raw: '{"a":1}' });
      const result = await readJsonFlag<{ a: number }>(stub, 'raw', { a: 0 });
      expect(result).toEqual({ a: 1 });
    });
  });
});
