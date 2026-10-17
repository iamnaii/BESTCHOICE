#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { inventory } from './lib/access-entrypoints.mjs';
export const surface = entry => crypto.createHash('sha256').update(JSON.stringify([
  ...entry.classDecorators, ...entry.decorators,
].filter(d => /^(Controller|WebSocketGateway|UseGuards|Roles|Public|Entity|RequireAudience|AccessPolicy|Get|Post|Put|Patch|Delete|Head|Options|All|Sse|SubscribeMessage)\(/.test(d)))).digest('hex').slice(0, 20);
const entries = inventory();
const manifest = JSON.parse(fs.readFileSync('apps/api/src/modules/employee-access/access-policy.manifest.json', 'utf8'));
const catalog = new Set([...fs.readFileSync('packages/shared/src/employee-access.ts', 'utf8').matchAll(/^  '([a-z][a-z.-]+)':/gm)].map(m => m[1]));
const errors = [];
const keys = new Set();
for (const entry of entries) {
  const key = `${entry.controller}.${entry.method}`;
  if (keys.has(key)) errors.push(`Duplicate entrypoint identity: ${key}`);
  keys.add(key);
  const policy = manifest[key];
  if (!policy) { errors.push(`Unclassified entrypoint: ${key} (${entry.file})`); continue; }
  if (policy.file !== entry.file || policy.transport !== entry.transport || policy.surface !== surface(entry)) errors.push(`Changed authorization/route surface requires review: ${key}`);
  if (!['staff', 'public', 'customer', 'integration', 'self-service'].includes(policy.classification)) errors.push(`Invalid classification: ${key}`);
  if (policy.classification === 'staff' && !catalog.has(policy.permission)) errors.push(`Missing/unknown capability: ${key}`);
  if (!['record', 'collection', 'none'].includes(policy.resolution)) errors.push(`Missing resolution contract: ${key}`);
  if (!['domain', 'none'].includes(policy.resource) || !policy.company) errors.push(`Missing resource contract: ${key}`);
  // Guard against accidental broad customer/public classifications of staff controllers.
  const decorators = [...entry.classDecorators, ...entry.decorators].join(' ');
  if (policy.classification === 'customer' && /Roles\(/.test(decorators)) errors.push(`Customer route has staff role gate: ${key}`);
  if (policy.classification === 'public' && /JwtAuthGuard/.test(decorators) && !/Public\(\)/.test(decorators)) errors.push(`Public route has JWT gate: ${key}`);
}
for (const key of Object.keys(manifest)) if (!keys.has(key)) errors.push(`Stale policy: ${key}`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else {
  const counts = {};
  for (const p of Object.values(manifest)) counts[p.classification] = (counts[p.classification] || 0) + 1;
  console.log(`Access inventory: ${entries.length} classified entrypoints in ${new Set(entries.map(e => e.file)).size} files. ${JSON.stringify(counts)}`);
  console.log(`${Object.values(manifest).filter(p => p.resource === 'domain').length} domain policies require persisted resource/scoped-query integrations; classification is not whole-program enforcement.`);
}
