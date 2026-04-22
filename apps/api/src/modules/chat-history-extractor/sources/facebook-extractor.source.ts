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
    let url: string | null = `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=participants,messages{message,from,created_time}&limit=100&access_token=${token}`;
    while (url) {
      const res: Response = await fetch(url);
      if (!res.ok) throw new Error(`FB Graph ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as FbConversationsPage;
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
      url = page.paging?.next ?? null;
    }
    return out;
  }
}
