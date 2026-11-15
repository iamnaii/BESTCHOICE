// Platform differences for the managed local preview (tools/local-preview.mjs and its runners).
// POSIX behaviour is the original one; every Windows branch is behind `isWindows`.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const isWindows = process.platform === 'win32';

/** Every isolated preview keeps its data under `<previewDirPrefix><random>`. */
export const previewDirPrefix = join(isWindows ? tmpdir() : '/tmp', 'bc-chat-credit.');

/** True when `dir` is a preview data directory created by these tools. */
export function isPreviewDir(dir) {
  if (typeof dir !== 'string' || !dir) return false;
  if (!isWindows) return dir.startsWith(previewDirPrefix);
  // Windows paths are case-insensitive and may arrive with either slash.
  return resolve(dir).toLowerCase().startsWith(previewDirPrefix.toLowerCase());
}

/**
 * Start time + command line of a live process, or null when it is gone.
 * Used to tell "our runner is still alive" apart from "the PID was reused".
 */
export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    if (isWindows) {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; ` +
        `if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') + ' ' + $p.CommandLine }`;
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim() || null;
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

// Entry scripts of the node_modules/.bin tools these scripts call. On Windows the
// .bin shims are .cmd files, which Node refuses to spawn without a shell.
const NODE_BIN_ENTRY = { prisma: 'prisma/build/index.js', 'ts-node': 'ts-node/dist/bin.js' };

function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  const found = candidates.find(path => path && /npm-cli\.js$/.test(path) && existsSync(path));
  if (!found) throw new Error('npm-cli.js not found next to node; run through `npm run`.');
  return found;
}

/** Git for Windows bash — never C:\Windows\System32\bash.exe, which is the WSL launcher. */
export function gitBash() {
  const candidates = [];
  try {
    candidates.push(resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).trim(), '../../../bin/bash.exe'));
  } catch { /* git missing: fall through to the standard install locations */ }
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (base) candidates.push(join(base, 'Git/bin/bash.exe'));
  }
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('Git Bash not found. Install Git for Windows (https://git-scm.com/download/win).');
  return found;
}

/**
 * Translate the POSIX-style commands used by the local tools into something Windows can spawn
 * without a shell (the repository path may contain spaces). Returns [command, args] unchanged elsewhere.
 */
export function resolveCommand(command, args, repo) {
  if (!isWindows) return [command, args];
  if (command === 'npm') return [process.execPath, [npmCli(), ...args]];
  if (command === 'bash') return [gitBash(), args];
  const bin = /[\\/]node_modules[\\/]\.bin[\\/]([^\\/]+)$/.exec(command);
  if (bin && NODE_BIN_ENTRY[bin[1]]) return [process.execPath, [join(repo, 'node_modules', NODE_BIN_ENTRY[bin[1]]), ...args]];
  return [command, args];
}
