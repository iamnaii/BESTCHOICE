/**
 * B3 §5 — สกอร์ FAQ ที่บอททั้ง 2 ตัวใช้ร่วมกัน
 *
 * ยกมาจาก `modules/chatbot-finance/services/knowledge.service.ts:47-143`
 * (พฤติกรรมเดิมทุกน้ำหนักคะแนน) เพื่อให้ tool ของบอทขายเรียกใช้ได้
 * โดย **ไม่ต้อง import ChatbotFinanceModule ข้ามฝั่ง** — บอทขายเป็นคนละ
 * pipeline และการ import module การเงินเข้ามาจะลาก LINE client/OTP/สลิป
 * ตามมาทั้งกอง
 */

export interface KbScorableEntry {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  priority: number;
}

export interface KbMatch {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string;
  score: number;
}

const THAI_PARTICLES = [
  'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'ไหม', 'หรือ', 'แล้ว', 'ได้', 'ที่',
  'ของ', 'ให้', 'กับ', 'จะ', 'อยาก', 'ต้องการ',
];

export function tokenizeThai(text: string): string[] {
  const tokens = text
    .split(/[\s,.\-!?:;()[\]{}/\\|@#$%^&*+=<>~`'"]+/)
    .filter((t) => t.length >= 2);

  const extraTokens: string[] = [];
  for (const token of tokens) {
    for (const particle of THAI_PARTICLES) {
      const idx = token.indexOf(particle);
      if (idx > 1) {
        extraTokens.push(token.slice(0, idx));
        extraTokens.push(token.slice(idx));
      }
    }
  }
  return [...new Set([...tokens, ...extraTokens])].filter((t) => t.length >= 2);
}

export function scoreKbEntries(
  query: string,
  entries: KbScorableEntry[],
  take = 3,
): KbMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const queryTokens = tokenizeThai(normalized);

  return entries
    .map((e) => {
      let score = 0;
      let keywordMatches = 0;

      for (const kw of e.triggerKeywords) {
        if (normalized.includes(kw.toLowerCase())) {
          score += 3;
          keywordMatches++;
        }
      }

      for (const kw of e.triggerKeywords) {
        const kwLower = kw.toLowerCase();
        for (const token of queryTokens) {
          if (token.length >= 2 && kwLower.includes(token) && !normalized.includes(kwLower)) {
            score += 2;
            break;
          }
        }
      }

      for (const ex of e.exampleQuestions) {
        const exLower = ex.toLowerCase();
        if (normalized.includes(exLower) || exLower.includes(normalized)) {
          score += 1;
        } else {
          const exTokens = tokenizeThai(exLower);
          const overlap = queryTokens.filter(
            (t) => t.length >= 2 && exTokens.some((et) => et.includes(t) || t.includes(et)),
          );
          if (overlap.length >= 2) score += 0.5;
        }
      }

      score += e.priority * 0.05;
      const hasRealMatch = keywordMatches > 0 || score > e.priority * 0.05;

      return {
        intent: e.intent,
        category: e.category,
        responseTemplate: e.responseTemplate,
        responseType: e.responseType,
        score: hasRealMatch ? score : 0,
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}
