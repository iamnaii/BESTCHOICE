import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import type { ExtractedMessage } from './line-extractor.source';

interface FbMessage {
  id: string;
  message?: string;
  from: { id: string; name?: string };
  created_time: string;
}
interface FbConversation {
  id: string;
  participants: { data: { id: string; name?: string }[] };
  updated_time?: string;
  messages: { data: FbMessage[]; paging?: { next?: string } };
}
interface FbConversationsPage {
  data: FbConversation[];
  paging?: { next?: string };
}

/**
 * FacebookExtractorSource — pulls conversations from a FB Page via Graph API.
 *
 * Credentials read from Integration Hub ("facebook" integration):
 * - pageAccessToken (long-lived Page Access Token)
 * - pageId
 *
 * Managed at /integrations in the admin UI — no redeploy needed to rotate.
 * Env var fallback is handled by IntegrationConfigService for dev/testing.
 */
@Injectable()
export class FacebookExtractorSource {
  private readonly logger = new Logger(FacebookExtractorSource.name);

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  async extract(opts: { since: Date }): Promise<ExtractedMessage[]> {
    const cfg = await this.integrationConfig.getConfig('facebook');
    const token = cfg.pageAccessToken || '';
    const pageId = cfg.pageId || '';

    if (!token || !pageId) {
      this.logger.warn('Facebook extractor skipped — no pageAccessToken/pageId in Integration Hub');
      return [];
    }

    const out: ExtractedMessage[] = [];
    let url: string | null =
      `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=participants,updated_time,messages{message,from,created_time}&limit=25`;
    while (url) {
      const page: FbConversationsPage = await this.fetchPage(url, token);
      for (const conv of page.data) {
        for (const m of conv.messages?.data ?? []) {
          if (!m.message) continue;
          const created = new Date(m.created_time);
          if (created < opts.since) continue;
          out.push({
            roomId: `fb:${conv.id}`,
            channel: 'FACEBOOK',
            role: m.from.id === pageId ? 'STAFF' : 'CUSTOMER',
            text: m.message,
            createdAt: created,
            externalMessageId: m.id,
          });
        }
      }
      // FB เรียง conversations ตาม updated_time ล่าสุดก่อน — ถ้าทั้งหน้าเก่ากว่าช่วงที่ขอ
      // หน้าถัด ๆ ไปยิ่งเก่ากว่าแน่นอน หยุดได้เลย (เพจมีแชทสะสมหลายปี ไล่ทั้งเพจ = ชั่วโมง+)
      const allStale =
        page.data.length > 0 &&
        page.data.every((c) => c.updated_time && new Date(c.updated_time) < opts.since);
      url = allStale ? null : (page.paging?.next ?? null);
    }
    return out;
  }

  /**
   * ยิง 1 หน้าแบบทนทาน — FB มี failure mode 2 แบบที่เจอจริงตอนไล่ทั้งเพจ:
   * 1. "Please reduce the amount of data" (code 1) — หน้าหนึ่งใหญ่เกิน ขนาดที่รับได้
   *    ขึ้นกับความยาวแชทจริง กำหนดตายตัวไม่ได้ → หั่น limit ครึ่งแล้วยิงซ้ำ (ต่ำสุด 1)
   * 2. transient (code 2, is_transient=true / 5xx) — server ล่มชั่วคราว โผล่ได้ทุกเมื่อ
   *    ระหว่างไล่หลายร้อยหน้า → backoff แล้วยิงซ้ำ สูงสุด 5 ครั้ง/หน้า
   */
  private async fetchPage(url: string, token: string): Promise<FbConversationsPage> {
    const attempt = new URL(url);
    const TRANSIENT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
    let transientRetries = 0;
    for (;;) {
      const res: Response = await fetch(attempt.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return (await res.json()) as FbConversationsPage;
      const body = await res.text();
      const limit = Number(attempt.searchParams.get('limit') ?? '25');
      if (body.includes('reduce the amount of data') && limit > 1) {
        const smaller = Math.max(1, Math.floor(limit / 2));
        this.logger.warn(`FB Graph ขอให้ลดขนาด — ลอง limit=${smaller} (เดิม ${limit})`);
        attempt.searchParams.set('limit', String(smaller));
        continue;
      }
      const transient = body.includes('"is_transient":true') || res.status >= 500;
      if (transient && transientRetries < TRANSIENT_DELAYS_MS.length) {
        const delayMs = TRANSIENT_DELAYS_MS[transientRetries++];
        this.logger.warn(
          `FB Graph ล่มชั่วคราว (${res.status}) — รอ ${delayMs / 1000}s แล้วลองใหม่ (${transientRetries}/${TRANSIENT_DELAYS_MS.length})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(`FB Graph ${res.status}: ${body}`);
    }
  }
}
