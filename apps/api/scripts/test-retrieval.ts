import { PrismaClient } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';

const project = process.env.GOOGLE_CLOUD_PROJECT!;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function embed(text: string): Promise<number[]> {
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/text-multilingual-embedding-002:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ content: text, task_type: 'RETRIEVAL_QUERY' }] }),
  });
  const j: any = await res.json();
  return j.predictions[0].embeddings.values;
}

async function main() {
  const prisma = new PrismaClient();
  const queries = [
    'ราคาเท่าไหร่คะ',
    'ร้านอยู่ที่ไหน',
    'ผ่อนกี่งวดได้บ้าง',
    'ใช้เอกสารอะไรบ้าง',
    'iPhone 15 มีไหม',
    'อยากผ่อน iphone ดอกเบี้ยเท่าไร',
    'เปิดกี่โมง',
    'ดาวน์ขั้นต่ำเท่าไหร่',
    'ทำงานออนไลน์ผ่อนได้ไหม',
    'อยู่ลาว ผ่อนได้ไหม',
  ];

  for (const q of queries) {
    const vec = await embed(q);
    const literal = `[${vec.join(',')}]`;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT customer_message, human_edit, embedding <=> $1::vector AS distance
       FROM ai_training_pairs
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT 3`,
      literal
    );
    console.log(`\n🔎 Query: "${q}"`);
    rows.forEach((r, i) => {
      const a = String(r.human_edit).slice(0, 60).replace(/\n/g, ' ');
      console.log(`  ${i + 1}. [d=${Number(r.distance).toFixed(3)}] Q: "${r.customer_message.slice(0, 40)}"`);
      console.log(`     A: "${a}..."`);
    });
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
