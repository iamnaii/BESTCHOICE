import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_FILE_UPLOAD_CONCURRENCY,
  legacyFileContentType,
  normalizeLegacyFilePath,
  uploadLegacyFiles,
} from '../files';

/** อัปโหลดไฟล์แนบของระบบเก่า — ไฟล์สังเคราะห์ในโฟลเดอร์ชั่วคราวเท่านั้น */

type Call = { key: string; body: Buffer; contentType: string };

class UploadBoom extends Error {}

/** storage ปลอม: จดทุกครั้งที่เรียก + นับงานที่ค้างพร้อมกันสูงสุด · คืน key แบบ StorageService.upload */
function fakeStorage(opts: { delayMs?: number; failKeys?: string[] } = {}) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    calls,
    maxInFlight: () => maxInFlight,
    async upload(key: string, body: Buffer, contentType: string): Promise<string> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        // ข้อความ error ของจริงอาจมี path/ชื่อลูกค้า — ต้องไม่หลุดไปใน `failed[].reason`
        if (opts.failKeys?.includes(key)) throw new UploadBoom(`อัปโหลดไม่ได้ ${key} นายสมมติ`);
        calls.push({ key, body, contentType });
        return key;
      } finally {
        inFlight--;
      }
    },
  };
}

describe('normalizeLegacyFilePath', () => {
  it.each<[string, string]>([
    ['uploads/identity/a.jpg', 'uploads/identity/a.jpg'],
    ['./uploads/identity/a.jpg', 'uploads/identity/a.jpg'],
    ['uploads\\identity\\a.jpg', 'uploads/identity/a.jpg'], // dump สังเคราะห์ใช้ backslash แบบ Windows
    ['uploads//identity/./a.jpg', 'uploads/identity/a.jpg'],
    ['  upload/payment/b.PNG  ', 'upload/payment/b.PNG'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeLegacyFilePath(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '../x.jpg',
    'uploads/../x.jpg', // `..` ถูกปฏิเสธแม้ยังอยู่ข้างใน
    'uploads\\..\\..\\x.jpg',
    '/abs/x.jpg',
    '\\abs\\x.jpg',
    'C:\\uploads\\x.jpg',
    'C:x.jpg',
    'https://example.test/uploads/x.jpg',
    'uploads/a\0.jpg',
    './',
  ])('rejects %j', (input) => {
    expect(normalizeLegacyFilePath(input)).toBeNull();
  });
});

describe('legacyFileContentType', () => {
  it.each<[string, string]>([
    ['a.jpg', 'image/jpeg'],
    ['a.JPEG', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.Pdf', 'application/pdf'],
    ['a.heic', 'image/heic'],
    ['a.heif', 'image/heif'],
    ['a.webp', 'image/webp'],
    ['a.gif', 'image/gif'],
    ['a.bin', 'application/octet-stream'],
    ['uploads/noext', 'application/octet-stream'],
  ])('%s → %s', (path, type) => {
    expect(legacyFileContentType(path)).toBe(type);
  });
});

describe('uploadLegacyFiles', () => {
  let base: string;
  let root: string;
  let sentinel: string;

  async function put(rel: string, bytes: string): Promise<void> {
    const target = join(root, rel);
    await fsp.mkdir(join(target, '..'), { recursive: true });
    await fsp.writeFile(target, bytes);
  }

  beforeEach(async () => {
    base = await fsp.mkdtemp(join(tmpdir(), 'legacy-files-'));
    root = join(base, 'httpdocs');
    await fsp.mkdir(root);
    // ไฟล์นอก filesDir — ต้องไม่ถูกอ่าน/อัปโหลดไม่ว่าทางใด
    sentinel = join(base, 'outside.jpg');
    await fsp.writeFile(sentinel, 'SENTINEL');
    await put('uploads/identity/a.jpg', 'A');
    await put('uploads/income/b.PDF', 'B');
    await put('upload/payment/c.heic', 'C');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(base, { recursive: true, force: true });
  });

  it('uploads an existing file under `<prefix>/<path>` with the content type of its extension', async () => {
    const storage = fakeStorage();
    const rels = ['uploads/identity/a.jpg', 'uploads/income/b.PDF', 'upload/payment/c.heic'];
    const result = await uploadLegacyFiles(root, rels, storage);

    expect(result.missing).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(Object.fromEntries(result.urls)).toEqual({
      'uploads/identity/a.jpg': 'legacy-import/uploads/identity/a.jpg',
      'uploads/income/b.PDF': 'legacy-import/uploads/income/b.PDF',
      'upload/payment/c.heic': 'legacy-import/upload/payment/c.heic',
    });
    const byKey = new Map(storage.calls.map((c) => [c.key, c]));
    expect(byKey.get('legacy-import/uploads/identity/a.jpg')?.contentType).toBe('image/jpeg');
    expect(byKey.get('legacy-import/uploads/identity/a.jpg')?.body.toString()).toBe('A');
    expect(byKey.get('legacy-import/uploads/income/b.PDF')?.contentType).toBe('application/pdf');
    expect(byKey.get('legacy-import/upload/payment/c.heic')?.contentType).toBe('image/heic');
  });

  it('uses the given prefix (trailing slash trimmed) and refuses an unsafe one', async () => {
    const storage = fakeStorage();
    const result = await uploadLegacyFiles(root, ['uploads/identity/a.jpg'], storage, 'rehearsal/');
    expect(result.urls.get('uploads/identity/a.jpg')).toBe('rehearsal/uploads/identity/a.jpg');

    for (const prefix of ['', '/', '/abs', '../x', 'a//b', 'a\\b']) {
      await expect(
        uploadLegacyFiles(root, ['uploads/identity/a.jpg'], storage, prefix),
      ).rejects.toThrow(/prefix/);
    }
    expect(storage.calls).toHaveLength(1);
  });

  it('puts a file that does not exist (or is a folder) in `missing` without calling storage', async () => {
    const storage = fakeStorage();
    const result = await uploadLegacyFiles(
      root,
      ['uploads/identity/a.jpg', 'uploads/identity/gone.jpg', 'uploads/identity', 'nope/x.jpg'],
      storage,
    );
    expect(result.missing).toEqual(['nope/x.jpg', 'uploads/identity', 'uploads/identity/gone.jpg']);
    expect([...result.urls.keys()]).toEqual(['uploads/identity/a.jpg']);
    expect(storage.calls.map((c) => c.key)).toEqual(['legacy-import/uploads/identity/a.jpg']);
  });

  it('rejects `..`, absolute, drive and URL paths into `missing` — nothing is read or uploaded', async () => {
    const readFile = jest.spyOn(fsp, 'readFile');
    const storage = fakeStorage();
    const rels = [
      '../outside.jpg',
      'uploads/../../outside.jpg',
      'uploads\\..\\..\\outside.jpg',
      sentinel, // absolute path ของไฟล์ที่มีอยู่จริง
      '/abs/x.jpg',
      'C:\\outside.jpg',
      'https://example.test/outside.jpg',
    ];
    const result = await uploadLegacyFiles(root, rels, storage);

    expect(result.missing).toEqual([...rels].sort());
    expect(result.urls.size).toBe(0);
    expect(result.failed).toEqual([]);
    expect(storage.calls).toHaveLength(0);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('refuses a symlink (file or folder) that escapes filesDir — the target is never read', async () => {
    await fsp.symlink(sentinel, join(root, 'uploads', 'identity', 'link.jpg'));
    await fsp.symlink(base, join(root, 'uploads', 'escape'));
    // ลิงก์ที่ชี้กลับเข้าไปข้างใน filesDir ใช้ได้ตามปกติ
    await fsp.symlink(
      join(root, 'uploads', 'identity', 'a.jpg'),
      join(root, 'uploads', 'alias.jpg'),
    );
    const readFile = jest.spyOn(fsp, 'readFile');
    const storage = fakeStorage();

    const result = await uploadLegacyFiles(
      root,
      ['uploads/identity/link.jpg', 'uploads/escape/outside.jpg', 'uploads/alias.jpg'],
      storage,
    );

    expect(result.missing).toEqual(['uploads/escape/outside.jpg', 'uploads/identity/link.jpg']);
    expect(result.urls.get('uploads/alias.jpg')).toBe('legacy-import/uploads/alias.jpg');
    expect(storage.calls.map((c) => c.body.toString())).toEqual(['A']);
    // tmpdir บน macOS เป็นลิงก์ (/var → /private/var) — เทียบชื่อไฟล์ ไม่ใช่ path เต็ม
    expect(readFile.mock.calls.map(([p]) => String(p))).toEqual([
      expect.stringMatching(/identity\/a\.jpg$/),
    ]);
    expect(storage.calls.some((c) => c.body.toString() === 'SENTINEL')).toBe(false);
  });

  it('gives the same key for the same path on every call', async () => {
    const first = await uploadLegacyFiles(root, ['uploads/identity/a.jpg'], fakeStorage());
    const second = await uploadLegacyFiles(root, ['uploads/identity/a.jpg'], fakeStorage());
    expect(second.urls.get('uploads/identity/a.jpg')).toBe(
      first.urls.get('uploads/identity/a.jpg'),
    );
    expect(first.urls.get('uploads/identity/a.jpg')).toBe('legacy-import/uploads/identity/a.jpg');
  });

  it('uploads a repeated path once and maps every spelling of it to the same key', async () => {
    const storage = fakeStorage();
    const spellings = [
      'uploads/identity/a.jpg',
      'uploads/identity/a.jpg',
      './uploads/identity/a.jpg',
      'uploads\\identity\\a.jpg',
    ];
    const result = await uploadLegacyFiles(root, spellings, storage);

    expect(storage.calls).toHaveLength(1);
    expect(result.urls.size).toBe(3);
    for (const s of spellings) {
      expect(result.urls.get(s)).toBe('legacy-import/uploads/identity/a.jpg');
    }
    expect(result.missing).toEqual([]);
  });

  it('dedupes and sorts `missing`', async () => {
    const result = await uploadLegacyFiles(
      root,
      ['uploads/z.jpg', '../a.jpg', 'uploads/z.jpg', 'uploads/m.jpg', '../a.jpg'],
      fakeStorage(),
    );
    expect(result.missing).toEqual(['../a.jpg', 'uploads/m.jpg', 'uploads/z.jpg']);
  });

  it(`never has more than ${LEGACY_FILE_UPLOAD_CONCURRENCY} uploads in flight`, async () => {
    expect(LEGACY_FILE_UPLOAD_CONCURRENCY).toBe(8);
    const rels: string[] = [];
    for (let i = 0; i < 20; i++) {
      const rel = `uploads/product/p${String(i).padStart(2, '0')}.jpg`;
      await put(rel, `P${i}`);
      rels.push(rel);
    }
    const storage = fakeStorage({ delayMs: 30 });
    const result = await uploadLegacyFiles(root, rels, storage);

    expect(result.urls.size).toBe(20);
    expect(storage.calls).toHaveLength(20);
    expect(storage.maxInFlight()).toBe(8);
  });

  it('keeps going when one upload fails — `failed` carries the error class only', async () => {
    await put('uploads/identity/d.jpg', 'D');
    const storage = fakeStorage({ failKeys: ['legacy-import/uploads/income/b.PDF'] });
    const rels = ['uploads/identity/a.jpg', 'uploads/income/b.PDF', 'uploads/identity/d.jpg'];
    const result = await uploadLegacyFiles(root, rels, storage);

    expect(result.failed).toEqual([{ path: 'uploads/income/b.PDF', reason: 'upload:UploadBoom' }]);
    expect([...result.urls.keys()].sort()).toEqual([
      'uploads/identity/a.jpg',
      'uploads/identity/d.jpg',
    ]);
    expect(result.missing).toEqual([]);
    expect(JSON.stringify(result.failed)).not.toMatch(/นายสมมติ|อัปโหลดไม่ได้/);
  });

  it('records a read error (not "not found") in `failed` with the error code only', async () => {
    const original = fsp.readFile.bind(fsp);
    jest.spyOn(fsp, 'readFile').mockImplementation((async (p: unknown, ...rest: unknown[]) => {
      if (String(p).endsWith('b.PDF')) {
        throw Object.assign(new Error(`EIO: i/o error, read ${String(p)}`), { code: 'EIO' });
      }
      return (original as (...a: unknown[]) => Promise<Buffer>)(p, ...rest);
    }) as typeof fsp.readFile);
    const storage = fakeStorage();
    const result = await uploadLegacyFiles(
      root,
      ['uploads/identity/a.jpg', 'uploads/income/b.PDF'],
      storage,
    );

    expect(result.failed).toEqual([{ path: 'uploads/income/b.PDF', reason: 'read:EIO' }]);
    expect([...result.urls.keys()]).toEqual(['uploads/identity/a.jpg']);
  });

  it('throws before touching storage when filesDir is missing or not a folder', async () => {
    const storage = fakeStorage();
    await expect(
      uploadLegacyFiles(join(base, 'no-such-dir'), ['uploads/identity/a.jpg'], storage),
    ).rejects.toThrow(/--files-dir/);
    await expect(uploadLegacyFiles(sentinel, ['uploads/identity/a.jpg'], storage)).rejects.toThrow(
      /--files-dir/,
    );
    expect(storage.calls).toHaveLength(0);
  });
});
