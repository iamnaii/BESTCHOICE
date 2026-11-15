import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The single definition of "this is the throwaway database of a local preview".
// Every preview fixture refuses to run against anything else, so an application
// DATABASE_URL can never be seeded with synthetic data.
//
// POSIX (tools/preview-chat-credit.sh): a private PostgreSQL reached only through a
//   Unix socket inside /tmp/bc-chat-credit.*.
// Windows (tools/preview-chat-credit-win.mjs): Prisma has no Unix sockets there, so the
//   runner starts its own container on loopback with a random 36-hex password that it
//   keeps in `<preview dir>/pg-password`.
//
// PrismaService appends `&connection_limit=N&pool_timeout=N` to DATABASE_URL when it is
// constructed, so fixtures that run after it see that suffix — allow exactly those two.
const WINDOWS_PREVIEW_URL =
  /^postgresql:\/\/credit_test:([0-9a-f]{36})@127\.0\.0\.1:\d{2,5}\/bc_chat_credit_test\?schema=public(?:&connection_limit=\d+&pool_timeout=\d+)?$/;
const POSIX_PREVIEW_MARKER = '/bc_chat_credit_test?host=/tmp/bc-chat-credit.';

/** `platform` is a parameter only so both branches can be tested on any machine. */
export function isDisposablePreviewDatabase(
  url: string | undefined = process.env.DATABASE_URL,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!url) return false;
  return platform === 'win32' ? WINDOWS_PREVIEW_URL.test(url) : url.includes(POSIX_PREVIEW_MARKER);
}

/** The stricter check of the preview server: the database must belong to this preview directory. */
export function isIsolatedPreview(
  root: string | undefined,
  url: string | undefined = process.env.DATABASE_URL,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!root || !url) return false;
  if (platform !== 'win32') {
    return root.startsWith('/tmp/bc-chat-credit.') && url.includes(`/bc_chat_credit_test?host=${root}/socket`);
  }
  const prefix = join(tmpdir(), 'bc-chat-credit.').toLowerCase();
  const password = WINDOWS_PREVIEW_URL.exec(url)?.[1];
  if (!password || !resolve(root).toLowerCase().startsWith(prefix)) return false;
  // POSIX ties the database to the directory through the socket path. On Windows the tie is
  // the password this directory's runner generated for its own container.
  try {
    return readFileSync(join(resolve(root), 'pg-password'), 'utf8').trim() === password;
  } catch {
    return false;
  }
}
