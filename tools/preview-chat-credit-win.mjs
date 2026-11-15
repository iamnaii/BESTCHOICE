// Windows runner for the isolated local preview. The POSIX runner is tools/preview-chat-credit.sh;
// keep the two in step. Differences forced by Windows:
//   - PostgreSQL 16 + pgvector runs in Docker (pgvector/pgvector:pg16) published on 127.0.0.1 only,
//     because Prisma cannot use Unix sockets on Windows and the local PostgreSQL has no pgvector.
//   - Data lives in a Docker volume named after the preview directory, so it survives restarts.
//   - If this runner is killed without cleanup, local-preview.mjs stops what it left behind
//     (cleanWindowsLeftovers) on the next start or stop.
//   - There is no SIGTERM on Windows: local-preview.mjs asks this runner to stop by creating
//     `<preview dir>/stop.request`, and the runner shuts the API and the database down itself.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPreviewDir, isWindows, previewDirPrefix, resolveCommand } from './lib/local-platform.mjs';

const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const image = process.env.CREDIT_PG_IMAGE || 'pgvector/pgvector:pg16';
const sleep = ms => new Promise(done => setTimeout(done, ms));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!isWindows) fail('preview-chat-credit-win.mjs is the Windows runner; use tools/preview-chat-credit.sh here.');
const root = process.env.CREDIT_PREVIEW_DIR || mkdtempSync(previewDirPrefix);
if (!isPreviewDir(root)) fail(`Preview requires its own ${previewDirPrefix}* directory`);
const suffix = basename(resolve(root)).slice('bc-chat-credit.'.length);
if (!/^[A-Za-z0-9_-]+$/.test(suffix)) fail('Unexpected preview directory name');
// One container + one volume per preview directory; other checkouts get their own.
const name = `bc-chat-credit-${suffix}`;
const stopFile = join(root, 'stop.request');
const passwordFile = join(root, 'pg-password');

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const hostTimeZone = /^[A-Za-z0-9_+\-/]+$/.test(zone) ? zone : 'UTC';

let containerStarted = false;
let api = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (api?.pid && api.exitCode === null && api.signalCode === null) {
    // The API spawned Vite; /T takes the whole tree so the preview port is released.
    try { execFileSync('taskkill', ['/PID', String(api.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
  }
  // Like the POSIX runner: only stop a database this run started.
  if (containerStarted) {
    try { docker(['stop', '-t', '10', name]); } catch { /* already stopped */ }
    for (const file of ['runtime.json', 'api.pid', 'runner.pid']) rmSync(join(root, file), { force: true });
  }
  rmSync(stopFile, { force: true });
}
function exit(code) { cleanup(); process.exit(code); }
process.once('SIGINT', () => exit(130));
process.once('SIGTERM', () => exit(143));
process.once('SIGBREAK', () => exit(143));
process.once('SIGHUP', () => exit(129));

async function main() {
  mkdirSync(join(root, 'storage'), { recursive: true });
  rmSync(stopFile, { force: true });
  rmSync(join(root, 'runtime.json'), { force: true });

  try { docker(['version', '--format', '{{.Server.Version}}']); }
  catch { fail('Docker is not running. Start Docker Desktop, then run the command again.'); }

  const state = docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.State}}']);
  if (state === 'running') fail(`Preview database ${name} is already running under another runner; it was left alone. If no preview is running, stop it with: docker stop ${name}`);
  if (state) docker(['rm', name]);

  const volumeExists = docker(['volume', 'ls', '--filter', `name=^${name}$`, '--format', '{{.Name}}']) === name;
  if (volumeExists && !existsSync(passwordFile)) {
    fail(`Docker volume ${name} exists but its password file is missing. Remove the volume (docker volume rm ${name}) to start with fresh sample data.`);
  }
  if (!existsSync(passwordFile)) writeFileSync(passwordFile, randomBytes(18).toString('hex'), { mode: 0o600 });
  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!/^[0-9a-f]{36}$/.test(password)) fail(`Unexpected content in ${passwordFile}`);

  // The password travels through the environment, not the command line. Docker picks the
  // loopback port. The cluster is created like the POSIX runner's: C collation, host time zone
  // (both apply only when the volume is first initialised).
  docker(['run', '-d', '--rm', '--name', name, '--label', 'bc-chat-credit=preview',
    '-p', '127.0.0.1::5432', '-v', `${name}:/var/lib/postgresql/data`,
    '-e', 'POSTGRES_USER=credit_test', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=bc_chat_credit_test',
    '-e', 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --no-locale', '-e', `TZ=${hostTimeZone}`, image],
  { env: { ...process.env, POSTGRES_PASSWORD: password } });
  containerStarted = true;
  const port = Number(/:(\d+)\s*$/.exec(docker(['port', name, '5432/tcp']).split('\n')[0])?.[1]);
  if (!Number.isInteger(port)) { console.error('Could not read the preview database port.'); exit(1); }
  writeFileSync(join(root, 'runner.pid'), `${process.pid}\n`);

  // First start initialises the cluster on a socket-only temporary server; `-h 127.0.0.1`
  // makes pg_isready wait for the real one.
  const deadline = Date.now() + 90000;
  for (;;) {
    try { docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'credit_test', '-d', 'bc_chat_credit_test']); break; }
    catch {
      if (existsSync(stopFile)) exit(143);
      if (docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.State}}']) !== 'running') {
        console.error(`Preview database ${name} exited during startup.`);
        exit(1);
      }
      if (Date.now() > deadline) { console.error('Preview database did not become ready in 90s.'); exit(1); }
      await sleep(500);
    }
  }

  const env = {
    ...process.env,
    CREDIT_REPO_ROOT: repo,
    CREDIT_PREVIEW_ROOT: root,
    DATABASE_URL: `postgresql://credit_test:${password}@127.0.0.1:${port}/bc_chat_credit_test?schema=public`,
    NODE_ENV: 'test',
    VITE_API_URL: '/api/admin',
    VITE_SENTRY_DSN: '',
  };

  const [prisma, prismaArgs] = resolveCommand(join(repo, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], repo);
  const migrateLog = join(root, 'migrate.log');
  const fd = openSync(migrateLog, 'w');
  try { execFileSync(prisma, prismaArgs, { cwd: repo, env, stdio: ['ignore', fd, fd], windowsHide: true }); }
  catch { console.error(`Database migration failed. See ${migrateLog}`); exit(1); }
  finally { closeSync(fd); }
  if (existsSync(stopFile)) exit(143);

  const [tsNode, tsNodeArgs] = resolveCommand(join(repo, 'node_modules/.bin/ts-node'),
    ['--transpile-only', '--project', 'apps/api/tsconfig.json', 'apps/api/e2e/support/chat-credit-preview.ts'], repo);
  api = spawn(tsNode, tsNodeArgs, { cwd: repo, env, stdio: 'inherit', windowsHide: true });
  api.once('error', error => { console.error(error.message); exit(1); });
  api.once('exit', code => exit(code ?? 1));
  writeFileSync(join(root, 'api.pid'), `${api.pid}\n`);

  setInterval(() => { if (existsSync(stopFile)) exit(143); }, 500);
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); exit(1); });
