/**
 * Seed AI training pairs from real Facebook customer chats.
 *
 * Source: /Users/iamnaii/Desktop/BESTCHOICE/bestchoice-ai-bot/qa_pairs.csv
 * Target: ai_training_pairs (source = 'CHATCONE_IMPORT')
 *
 * Pipeline:
 *   1. Parse CSV (proper multiline support via csv-parse)
 *   2. Filter junk: empty, [รูปภาพ], [สติกเกอร์], very short
 *   3. Skip pairs already imported (dedupe by question+answer hash)
 *   4. Embed customer questions in batches of 250 via Vertex AI
 *   5. Insert with embedding via raw SQL (pgvector cast)
 *
 * Setup:
 *   gcloud auth application-default login
 *   export GOOGLE_CLOUD_PROJECT=<your-project-id>
 *
 * Run:
 *   cd apps/api
 *   npx tsx scripts/seed-fb-training.ts \
 *     --csv /Users/iamnaii/Desktop/BESTCHOICE/bestchoice-ai-bot/qa_pairs.csv
 */
import { parse } from 'csv-parse';
import { createReadStream } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { GoogleAuth } from 'google-auth-library';

const MODEL = process.env.VERTEX_EMBEDDING_MODEL ?? 'text-multilingual-embedding-002';
const LOCATION = process.env.VERTEX_LOCATION ?? 'us-central1';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const EMBED_BATCH = 250; // Vertex AI accepts up to 250 instances per request
const INSERT_BATCH = 100;

interface CsvRow {
  conversation_id: string;
  timestamp: string;
  customer_question: string;
  admin_answer: string;
}

interface CleanPair {
  question: string;
  answer: string;
  hash: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const JUNK_RE = /^\s*\[(รูปภาพ|สติกเกอร์|ไฟล์|วิดีโอ|ลิงก์|GIF|Reel|Reels)\]\s*$/i;
const ALL_JUNK_RE = /^(\s*\[(รูปภาพ|สติกเกอร์|ไฟล์|วิดีโอ|ลิงก์|GIF|Reel|Reels)\]\s*)+$/i;

function isJunk(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 3) return true;
  if (JUNK_RE.test(trimmed)) return true;
  if (ALL_JUNK_RE.test(trimmed)) return true;
  return false;
}

function makeHash(q: string, a: string): string {
  return createHash('sha256').update(`${q}\n||\n${a}`).digest('hex').slice(0, 32);
}

async function readCsv(path: string): Promise<CleanPair[]> {
  return new Promise((resolveP, rejectP) => {
    const rows: CleanPair[] = [];
    const seen = new Set<string>();
    let total = 0;
    let junked = 0;
    let dupes = 0;

    createReadStream(path)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: false }))
      .on('data', (row: CsvRow) => {
        total++;
        const q = (row.customer_question ?? '').trim();
        const a = (row.admin_answer ?? '').trim();
        if (isJunk(q) || isJunk(a)) {
          junked++;
          return;
        }
        const h = makeHash(q, a);
        if (seen.has(h)) {
          dupes++;
          return;
        }
        seen.add(h);
        rows.push({ question: q, answer: a, hash: h });
      })
      .on('end', () => {
        console.log(
          `  CSV parsed: ${total} rows → ${rows.length} usable (${junked} junk, ${dupes} dupes)`,
        );
        resolveP(rows);
      })
      .on('error', rejectP);
  });
}

class VertexEmbedder {
  private readonly auth: GoogleAuth;
  private readonly endpoint: string;
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private project: string) {
    this.auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] });
    this.endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.value;
    }
    const client = await this.auth.getClient();
    const tokenResp = await client.getAccessToken();
    if (!tokenResp.token) throw new Error('Failed to get GCP access token');
    // Tokens last ~1 hour; refresh proactively.
    this.cachedToken = { value: tokenResp.token, expiresAt: now + 50 * 60_000 };
    return tokenResp.token;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const maxAttempts = 5;
    let attempt = 0;
    let lastErr: Error | undefined;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        const token = await this.getToken();
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instances: texts.map((t) => ({ content: t, task_type: 'RETRIEVAL_DOCUMENT' })),
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            predictions: { embeddings: { values: number[] } }[];
          };
          return json.predictions.map((p) => p.embeddings.values);
        }
        const body = await res.text().catch(() => '');
        // Retry on 5xx + 429 (rate limit). Fail fast on 4xx (auth/input).
        const retriable = res.status >= 500 || res.status === 429;
        lastErr = new Error(`Vertex embed failed (${res.status}): ${body}`);
        if (!retriable || attempt >= maxAttempts) throw lastErr;
        const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        console.log(`     ⚠ ${res.status} on attempt ${attempt}/${maxAttempts}, retry in ${backoffMs / 1000}s`);
        await new Promise((r) => setTimeout(r, backoffMs));
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Vertex embed failed')) throw err;
        // Network error — retry
        lastErr = err as Error;
        if (attempt >= maxAttempts) throw lastErr;
        const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        console.log(`     ⚠ network error on attempt ${attempt}/${maxAttempts}: ${lastErr.message}, retry in ${backoffMs / 1000}s`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr ?? new Error('embed failed (unknown)');
  }
}

async function getExistingHashes(prisma: PrismaClient): Promise<Set<string>> {
  const existing = await prisma.aiTrainingPair.findMany({
    where: { source: 'CHATCONE_IMPORT' },
    select: { customerMessage: true, humanEdit: true },
  });
  const set = new Set<string>();
  for (const r of existing) {
    if (r.customerMessage && r.humanEdit) {
      set.add(makeHash(r.customerMessage, r.humanEdit));
    }
  }
  return set;
}

async function main() {
  const csvPath = resolve(arg('csv') ?? '');
  if (!csvPath || csvPath === resolve('')) {
    console.error('ระบุ --csv <path>');
    process.exit(1);
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
  if (!project) {
    console.error('GOOGLE_CLOUD_PROJECT not set');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const limit = Number(arg('limit') ?? '0') || undefined;

  console.log(`📂 Reading CSV: ${csvPath}`);
  const allPairs = await readCsv(csvPath);
  const target = limit ? allPairs.slice(0, limit) : allPairs;
  console.log(`🎯 Target: ${target.length} pairs${limit ? ` (limited from ${allPairs.length})` : ''}`);

  const prisma = new PrismaClient();
  console.log('🔍 Fetching existing pairs to dedupe…');
  const existingHashes = await getExistingHashes(prisma);
  const fresh = target.filter((p) => !existingHashes.has(p.hash));
  console.log(`   ${target.length - fresh.length} already imported, ${fresh.length} new`);

  if (dryRun) {
    console.log('⏸  --dry-run: skipping embed + insert');
    console.log('   sample:', fresh.slice(0, 3));
    await prisma.$disconnect();
    return;
  }

  if (fresh.length === 0) {
    console.log('✅ Nothing to import.');
    await prisma.$disconnect();
    return;
  }

  console.log(`🧠 Embedding + inserting ${fresh.length} pairs in batches of ${EMBED_BATCH} via Vertex AI (${MODEL})…`);
  const embedder = new VertexEmbedder(project);
  const start = Date.now();
  let processed = 0;
  for (let i = 0; i < fresh.length; i += EMBED_BATCH) {
    const slice = fresh.slice(i, i + EMBED_BATCH);
    const texts = slice.map((p) => p.question);
    const vecs = await embedder.embed(texts);

    // Insert this batch immediately so progress survives transient failures.
    for (let j = 0; j < slice.length; j += INSERT_BATCH) {
      const sub = slice.slice(j, j + INSERT_BATCH);
      const subVecs = vecs.slice(j, j + INSERT_BATCH);
      const values: string[] = [];
      const params: any[] = [];
      let p = 1;
      for (let k = 0; k < sub.length; k++) {
        const pair = sub[k];
        const vec = `[${subVecs[k].join(',')}]`;
        values.push(
          `($${p++}, 'ACCEPT', 'CHATCONE_IMPORT', $${p++}, $${p++}, 0.5, $${p++}::vector, $${p++}, NOW(), NOW())`,
        );
        params.push(randomUUID(), pair.question, pair.answer, vec, MODEL);
      }
      const sql = `
        INSERT INTO ai_training_pairs
          (id, type, source, customer_message, human_edit, quality, embedding, embedding_model, embedded_at, created_at)
        VALUES ${values.join(',')}
      `;
      await prisma.$executeRawUnsafe(sql, ...params);
    }

    processed += slice.length;
    const pct = Math.min(100, Math.round((processed / fresh.length) * 100));
    console.log(`   processed ${processed}/${fresh.length} (${pct}%)`);
  }
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   done in ${sec}s`);

  const finalCount = await prisma.aiTrainingPair.count({
    where: { source: 'CHATCONE_IMPORT' },
  });
  console.log(`\n✅ Seed complete. Total CHATCONE_IMPORT pairs in DB: ${finalCount}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
