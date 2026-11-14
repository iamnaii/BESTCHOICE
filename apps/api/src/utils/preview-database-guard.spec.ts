import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDisposablePreviewDatabase, isIsolatedPreview } from '../../e2e/support/preview-database';

// The guard decides whether synthetic preview fixtures may write to a database, so both
// platform branches are pinned here (the module lives under e2e/support, outside jest's roots).
const PW = 'a'.repeat(36);
const WIN = `postgresql://credit_test:${PW}@127.0.0.1:52487/bc_chat_credit_test?schema=public`;
const POOL = '&connection_limit=10&pool_timeout=15';
const POSIX = 'postgresql://credit_test@localhost:55476/bc_chat_credit_test?host=/tmp/bc-chat-credit.Ab12Cd/socket&schema=public';

describe('preview database guard', () => {
  describe('win32', () => {
    it.each([WIN, WIN + POOL])('accepts the runner URL %#', (url) => {
      expect(isDisposablePreviewDatabase(url, 'win32')).toBe(true);
    });

    it.each([
      ['empty', ''],
      ['localhost instead of loopback literal', WIN.replace('127.0.0.1', 'localhost')],
      ['another host', WIN.replace('127.0.0.1', '10.0.0.5')],
      ['host with a suffix', WIN.replace('127.0.0.1', '127.0.0.1.evil.example')],
      ['other database', WIN.replace('bc_chat_credit_test', 'installment_db')],
      ['database name with a suffix', WIN.replace('bc_chat_credit_test', 'bc_chat_credit_test_prod')],
      ['other user', WIN.replace('credit_test:', 'postgres:')],
      ['password too short', WIN.replace(PW, 'a'.repeat(35))],
      ['password too long', WIN.replace(PW, 'a'.repeat(37))],
      ['password not lower-case hex', WIN.replace(PW, 'A'.repeat(36))],
      ['no password', WIN.replace(`:${PW}`, '')],
      ['extra host override', `${WIN}&host=/var/run/postgresql`],
      ['unknown parameter', `${WIN}&sslmode=disable`],
      ['pool suffix with a non-number', `${WIN}&connection_limit=x&pool_timeout=15`],
      ['pool suffix in the other order', `${WIN}&pool_timeout=15&connection_limit=10`],
      ['trailing newline', `${WIN}\n`],
      ['second authority', WIN.replace('@127.0.0.1', '@evil.example@127.0.0.1')],
      ['the POSIX socket URL', POSIX],
    ])('rejects %s', (_label, url) => {
      expect(isDisposablePreviewDatabase(url, 'win32')).toBe(false);
    });
  });

  describe('posix', () => {
    it.each([POSIX, POSIX + POOL])('accepts the socket URL %#', (url) => {
      expect(isDisposablePreviewDatabase(url, 'linux')).toBe(true);
      expect(isDisposablePreviewDatabase(url, 'darwin')).toBe(true);
    });

    it.each([
      ['empty', ''],
      ['application database', 'postgresql://postgres:postgres@localhost:5432/installment_db?schema=public'],
      ['socket outside /tmp/bc-chat-credit.*', POSIX.replace('/tmp/bc-chat-credit.Ab12Cd', '/var/run/postgresql')],
      ['other database on the preview socket', POSIX.replace('bc_chat_credit_test', 'installment_db')],
      ['the Windows loopback URL', WIN],
    ])('rejects %s', (_label, url) => {
      expect(isDisposablePreviewDatabase(url, 'linux')).toBe(false);
    });

    it('ties the database to the preview directory', () => {
      const root = '/tmp/bc-chat-credit.Ab12Cd';
      expect(isIsolatedPreview(root, POSIX, 'linux')).toBe(true);
      expect(isIsolatedPreview(root, POSIX + POOL, 'linux')).toBe(true);
      expect(isIsolatedPreview('/tmp/bc-chat-credit.Other1', POSIX, 'linux')).toBe(false);
      expect(isIsolatedPreview('/home/user/project', POSIX, 'linux')).toBe(false);
      expect(isIsolatedPreview(undefined, POSIX, 'linux')).toBe(false);
      expect(isIsolatedPreview(root, undefined, 'linux')).toBe(false);
    });
  });

  // Path handling is the host's, so the directory tie of the Windows branch runs on Windows only.
  (process.platform === 'win32' ? describe : describe.skip)('win32 directory tie', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'bc-chat-credit.'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('accepts only the URL carrying the password stored in that directory', () => {
      writeFileSync(join(root, 'pg-password'), PW);
      expect(isIsolatedPreview(root, WIN, 'win32')).toBe(true);
      expect(isIsolatedPreview(root, WIN + POOL, 'win32')).toBe(true);
      expect(isIsolatedPreview(root.toUpperCase(), WIN, 'win32')).toBe(true);
      expect(isIsolatedPreview(root, WIN.replace(PW, 'b'.repeat(36)), 'win32')).toBe(false);
    });

    it('rejects a directory without a password file or outside the temp prefix', () => {
      expect(isIsolatedPreview(root, WIN, 'win32')).toBe(false);
      const outside = mkdtempSync(join(tmpdir(), 'not-a-preview.'));
      try {
        writeFileSync(join(outside, 'pg-password'), PW);
        expect(isIsolatedPreview(outside, WIN, 'win32')).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});
