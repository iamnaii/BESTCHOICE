import { createHash } from 'crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { docsOutputDir } from './runtime';

/**
 * Per-domain evidence directory + append-only manifest.
 *
 * Every domain writes `<DOCS_QA_OUTPUT>/<domain>/…` and `<DOCS_QA_OUTPUT>/manifest/<domain>.jsonl`
 * so two domains never edit the same file; `tools/docs-integration.mjs` merges the
 * parts into `manifest.json` after Jest finishes.
 */
export type ScenarioStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export interface ScenarioRecord {
  /** Stable id, e.g. `contract-pdpa/download-bytes-match-storage`. */
  id: string;
  title: string;
  /** Document families covered, e.g. ['CONTRACT', 'PDPA_CONSENT']. */
  documents: string[];
  /** Real routes exercised (method + path). */
  routes: string[];
  /** Guards/interceptors that ran for real, e.g. ['JwtAuthGuard', 'RolesGuard']. */
  guards: string[];
  renderer: 'chromium' | 'jspdf' | 'html' | 'none';
  /** Where the source data came from. */
  source: 'api' | 'service' | 'prisma-fixture';
  status: ScenarioStatus;
  artifacts: string[];
  /** Things replaced by fakes in this scenario — must be honest. */
  simulated: string[];
  /** Explicitly not verified here (printer, staging, …). */
  unverified?: string[];
  notes?: string;
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function domainDir(domain: string): string {
  const dir = join(docsOutputDir(), domain);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveArtifact(domain: string, name: string, bytes: Buffer | string): { path: string; relativePath: string; sha256: string; bytes: number } {
  const path = join(domainDir(domain), name);
  writeFileSync(path, bytes);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { path, relativePath: relative(docsOutputDir(), path), sha256: sha256(buffer), bytes: buffer.length };
}

export function recordScenario(domain: string, record: ScenarioRecord): void {
  const dir = join(docsOutputDir(), 'manifest');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${domain}.jsonl`), JSON.stringify({ domain, recordedAt: new Date().toISOString(), ...record }) + '\n');
}
