import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class FacebookExtractorSource {
  private readonly logger = new Logger(FacebookExtractorSource.name);
  private readonly token: string;
  private readonly pageId: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('FACEBOOK_PAGE_ACCESS_TOKEN') ?? '';
    this.pageId = config.get<string>('FACEBOOK_PAGE_ID') ?? '';
  }

  async extract(opts: { since: Date }): Promise<ExtractedMessage[]> {
    if (!this.token || !this.pageId) {
      this.logger.warn('Facebook extractor skipped — no token/pageId');
      return [];
    }
    const out: ExtractedMessage[] = [];
    let url: string | null = `https://graph.facebook.com/v19.0/${this.pageId}/conversations?fields=participants,messages{message,from,created_time}&limit=100&access_token=${this.token}`;
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
            role: m.from.id === this.pageId ? 'STAFF' : 'CUSTOMER',
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
