import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const output = join(repo, '.tmp/local-preview');
const stateFile = join(output, 'state.json');
const runner = join(repo, 'tools/preview-chat-credit.sh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
}

export function fingerprint() {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .split('\0').filter(path => /^(apps\/|packages\/|tools\/|package(?:-lock)?\.json$)/.test(path)).sort();
  const hash = createHash('sha256');
  for (const file of new Set(files)) {
    hash.update(file + '\0');
    try { hash.update(readFileSync(join(repo, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('<deleted>'); }
  }
  return hash.digest('hex');
}

export function run(command, args, cwd = repo, logFile) {
  return new Promise((resolve, reject) => {
    const fd = logFile ? openSync(logFile, 'a') : null;
    let child;
    try { child = spawn(command, args, { cwd, stdio: fd === null ? 'inherit' : ['ignore', fd, fd] }); }
    finally { if (fd !== null) closeSync(fd); }
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} failed (${signal || code})`)));
  });
}

function readState() {
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

async function infoAt(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/preview/info`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}

export function acquireLock(name) {
  mkdirSync(output, { recursive: true });
  const path = join(output, `${name}.lock.json`);
  const owner = { pid: process.pid, identity: processIdentity(process.pid), id: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify(owner));
      closeSync(fd);
      return () => {
        try { if (JSON.parse(readFileSync(path, 'utf8')).id === owner.id) rmSync(path); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      if (error.code !== 'EEXIST') throw error;
      const content = readFileSync(path, 'utf8');
      let previous;
      try { previous = JSON.parse(content); } catch { throw new Error(`Lock is being initialized; retry shortly: ${path}`); }
      if (processIdentity(previous.pid) === previous.identity) throw new Error(`Another local ${name} command is running (${previous.pid}).`);
      if (readFileSync(path, 'utf8') === content) rmSync(path);
    }
  }
  throw new Error(`Could not acquire ${path}; retry shortly.`);
}

function runnerAlive(state) {
  return Boolean(state?.repo === repo && state.identity && state.identity.includes(runner) && processIdentity(state.pid) === state.identity);
}

export function owned(state, info) {
  return Boolean(state && info && state.repo === repo && info.repoRoot === repo &&
    typeof state.runId === 'string' && state.runId.length > 0 && state.runId === info.runId &&
    info.isolated === true && info.ocr === 'mock' && info.storage === 'local-files');
}

async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied. Leave that server alone; choose a free LOCAL_PREVIEW_PORT.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function stopOwned(state) {
  const identity = processIdentity(state?.pid);
  if (!identity) return;
  if (state.repo !== repo || identity !== state.identity || !identity.includes(runner)) {
    throw new Error('Preview process ownership does not match; no process was stopped.');
  }
  process.kill(state.pid, 'SIGTERM');
  const deadline = Date.now() + 30000;
  while (processIdentity(state.pid) === identity) {
    if (Date.now() > deadline) throw new Error(`Preview did not stop cleanly. Inspect ${state.log}; no forced kill was used.`);
    await sleep(200);
  }
}

export async function previewStatus() {
  const state = readState();
  const info = state ? await infoAt(state.port) : null;
  const running = owned(state, info) && runnerAlive(state);
  return { state, info, running, orphaned: owned(state, info) && !runnerAlive(state), current: running && info.sourceFingerprint === fingerprint() };
}

export async function ensurePreview({ prepared = false } = {}) {
  const release = acquireLock('manager');
  try {
    const previous = readState();
    const port = Number(process.env.LOCAL_PREVIEW_PORT || previous?.port || 5195);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_PREVIEW_PORT must be 1024–65535.');
    const sourceFingerprint = fingerprint();
    const previousInfo = previous ? await infoAt(previous.port) : null;
    if (owned(previous, previousInfo) && !runnerAlive(previous)) throw new Error(`Orphaned preview is still listening. Inspect ${previous.log}; no server was reused or stopped.`);
    if (owned(previous, previousInfo) && previous.port === port && previousInfo.sourceFingerprint === sourceFingerprint) {
      return { ...previousInfo, url: `http://localhost:${port}/inbox`, reused: true };
    }
    if (previous && processIdentity(previous.pid)) {
      if (!owned(previous, previousInfo)) throw new Error(`Existing preview could not be verified. Inspect ${previous.log} before restarting.`);
      await stopOwned(previous);
    }
    await portAvailable(port);
    if (!prepared) {
      await run('npm', ['run', 'build', '--workspace=@installment/shared']);
      await run(join(repo, 'node_modules/.bin/prisma'), ['generate', '--schema', 'apps/api/prisma/schema.prisma']);
      await run(join(repo, 'node_modules/.bin/prisma'), ['generate', '--schema', 'apps/api/prisma-finance/schema.prisma']);
    }
    const runId = randomUUID();
    const dataDir = previous?.repo === repo && previous.dataDir?.startsWith('/tmp/bc-chat-credit.')
      ? previous.dataDir : mkdtempSync('/tmp/bc-chat-credit.');
    const log = join(output, 'server.log');
    const fd = openSync(log, 'w');
    const child = spawn('bash', [runner], {
      cwd: repo, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, CREDIT_PREVIEW_PORT: String(port), CREDIT_PREVIEW_DIR: dataDir,
        CREDIT_REAL_OCR: '0', CREDIT_REAL_STORAGE: '0', CREDIT_LOCAL_RUN_ID: runId,
        CREDIT_SOURCE_FINGERPRINT: sourceFingerprint, CREDIT_SOURCE_REVISION: git('rev-parse', '--short', 'HEAD') },
    });
    closeSync(fd);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    const state = { repo, pid: child.pid, identity: processIdentity(child.pid), runId, port, dataDir, log };
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    try {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const info = await infoAt(port);
        if (owned(state, info)) {
          if (fingerprint() !== sourceFingerprint) throw new Error('Source changed during preview startup; run the command again.');
          return { ...info, url: `http://localhost:${port}/inbox`, reused: false };
        }
        if (!processIdentity(child.pid)) break;
        await sleep(300);
      }
      throw new Error(`Local preview did not become ready. Inspect ${log}`);
    } catch (error) { await stopOwned(state); throw error; }
  } finally { release(); }
}

async function main() {
  const action = process.argv[2] || 'start';
  if (action === 'status') {
    const status = await previewStatus();
    console.log(JSON.stringify({ repo, ...status }, null, 2));
    if (!status.running || !status.current) process.exitCode = 1;
  } else if (action === 'stop') {
    const release = acquireLock('manager');
    try {
      const { state, info, orphaned } = await previewStatus();
      if (orphaned) throw new Error('Orphaned preview is still listening; no stopped status can be confirmed.');
      if (state && processIdentity(state.pid)) {
        if (!owned(state, info)) throw new Error('Cannot verify managed preview; no process was stopped.');
        await stopOwned(state);
      }
    } finally { release(); }
    console.log('Managed local preview stopped; test data retained.');
  } else if (action === 'start') {
    const info = await ensurePreview();
    console.log(`${info.reused ? 'Reused' : 'Started'} ${info.url}\nWorkspace: ${repo}\nSynthetic Inbox/credit/offer preview; AI mocked.`);
  } else throw new Error('Usage: node tools/local-preview.mjs [start|status|stop]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
