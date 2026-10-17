import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inventory } from './lib/access-entrypoints.mjs';

const checker = fileURLToPath(new URL('./check-access-coverage.mjs', import.meta.url));
test('coverage rejects Public routes classified as staff or self-service', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'access-coverage-'));
  try {
    fs.mkdirSync(path.join(root, 'apps/api/src/modules/employee-access'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages/shared/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/api/src/invite.controller.ts'), "@Controller('invite')\nclass InviteController { @Get('verify') @Public() verify() {} }\n");
    fs.writeFileSync(path.join(root, 'packages/shared/src/employee-access.ts'), "  'users.manage': []\n");
    const [entry] = inventory(root);
    const surface = crypto.createHash('sha256').update(JSON.stringify([...entry.classDecorators, ...entry.decorators])).digest('hex').slice(0, 20);
    const manifestPath = path.join(root, 'apps/api/src/modules/employee-access/access-policy.manifest.json');
    for (const classification of ['staff', 'self-service', 'public']) {
      fs.writeFileSync(manifestPath, JSON.stringify({ 'InviteController.verify': {
        classification, permission: classification === 'staff' ? 'users.manage' : null,
        resource: 'none', resolution: 'none', company: 'not-applicable', file: entry.file,
        transport: entry.transport, surface,
      } }));
      const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      if (classification === 'public') assert.equal(result.status, 0, result.stderr);
      else {
        assert.equal(result.status, 1, `${classification}: expected rejection; ${result.stdout}`);
        assert.match(result.stderr, /Public route requires a nonstaff classification: InviteController.verify/);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
