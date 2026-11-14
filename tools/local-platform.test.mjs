import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { isPreviewDir, isWindows, previewDirPrefix, processIdentity, resolveCommand } from './lib/local-platform.mjs';

const repo = join(previewDirPrefix, '..', 'repo with space');

test('preview directories are recognised only under the platform prefix', () => {
  assert.equal(isPreviewDir(`${previewDirPrefix}abc123`), true);
  assert.equal(isPreviewDir(undefined), false);
  assert.equal(isPreviewDir(''), false);
  assert.equal(isPreviewDir(join(previewDirPrefix, '..', 'somewhere-else')), false);
  // A sibling that merely shares the start of the name is not a preview directory.
  assert.equal(isPreviewDir(`${previewDirPrefix.slice(0, -1)}-other`), false);
  if (isWindows) {
    assert.equal(isPreviewDir(`${previewDirPrefix}ABC`.toUpperCase()), true, 'Windows paths are case-insensitive');
    assert.equal(isPreviewDir(`${previewDirPrefix}x`.replaceAll('\\', '/')), true, 'either slash');
  } else {
    assert.equal(previewDirPrefix, '/tmp/bc-chat-credit.', 'POSIX prefix is unchanged');
  }
});

test('the identity of the current process is stable and a missing PID has none', () => {
  const identity = processIdentity(process.pid);
  assert.ok(identity && identity.length > 0);
  assert.equal(processIdentity(process.pid), identity);
  assert.equal(processIdentity(0), null);
  assert.equal(processIdentity(1), null);
  assert.equal(processIdentity(2 ** 31 - 2), null);
});

test('commands are spawned without a shell on Windows and unchanged elsewhere', () => {
  const prisma = join(repo, 'node_modules/.bin/prisma');
  const tsNode = join(repo, 'node_modules/.bin/ts-node');
  if (!isWindows) {
    for (const command of ['npm', 'bash', prisma, 'git']) assert.deepEqual(resolveCommand(command, ['x'], repo), [command, ['x']]);
    return;
  }
  const [npm, npmArgs] = resolveCommand('npm', ['run', 'build'], repo);
  assert.equal(npm, process.execPath);
  assert.match(npmArgs[0], /npm-cli\.js$/);
  assert.deepEqual(npmArgs.slice(1), ['run', 'build']);
  const [bash] = resolveCommand('bash', ['tools/check-types.sh'], repo);
  assert.match(bash, /[\\/]bash\.exe$/i);
  assert.doesNotMatch(bash, /System32/i, 'never the WSL launcher');
  assert.deepEqual(resolveCommand(prisma, ['generate'], repo), [process.execPath, [join(repo, 'node_modules/prisma/build/index.js'), 'generate']]);
  assert.deepEqual(resolveCommand(tsNode, ['a.ts'], repo), [process.execPath, [join(repo, 'node_modules/ts-node/dist/bin.js'), 'a.ts']]);
  assert.deepEqual(resolveCommand('git', ['status'], repo), ['git', ['status']]);
});
