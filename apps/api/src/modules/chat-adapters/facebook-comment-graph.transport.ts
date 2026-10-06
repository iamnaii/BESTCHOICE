import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { withRequiredFacebookPageFields } from '@installment/shared';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import type { FacebookCommentEvidence } from './facebook-comment-capability';
import type { FacebookCommentTransport, PublicCommentInput } from './facebook-comment-client';

const GRAPH_VERSION = 'v25.0';
const ID = /^\d+(?:_\d+)?$/;
type Json = Record<string, unknown>;
type Credentials = { pageId: string; appId: string; token: string; secret: string };
const object = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

/** Fixed-origin Graph adapter. Never logs provider bodies/credentials or retries a POST. */
@Injectable()
export class FacebookCommentGraphTransport implements FacebookCommentTransport {
  private cache?: { key: string; until: number; value: Promise<FacebookCommentEvidence> };
  constructor(private readonly config: IntegrationConfigService) {}

  private async credentials(pageId: string): Promise<Credentials | null> {
    const cfg = await this.config.getConfig('facebook');
    if (
      !/^\d+$/.test(pageId) ||
      cfg.pageId !== pageId ||
      !/^\d+$/.test(cfg.appId ?? '') ||
      !cfg.pageAccessToken ||
      !cfg.appSecret ||
      !cfg.verifyToken
    )
      return null;
    return { pageId, appId: cfg.appId, token: cfg.pageAccessToken, secret: cfg.appSecret };
  }

  private async request(
    c: Credentials,
    path: string,
    params: Record<string, string> = {},
    body?: Record<string, string>,
    appToken = false,
  ) {
    const token = appToken ? `${c.appId}|${c.secret}` : c.token;
    const query = new URLSearchParams(params);
    // debug_token requires input_token; this URL must never be logged or returned to callers.
    if (!appToken)
      query.set('appsecret_proof', createHmac('sha256', c.secret).update(token).digest('hex'));
    try {
      const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}?${query}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      });
      const data = object(await response.json());
      return { ok: response.ok && !data.error, status: response.status, data };
    } catch {
      throw new Error('FACEBOOK_COMMENT_GRAPH_UNAVAILABLE');
    }
  }

  private async subscriptions(c: Credentials): Promise<Json[]> {
    const rows: Json[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const result = await this.request(c, `${c.pageId}/subscribed_apps`, {
        fields: 'id,subscribed_fields',
        limit: '100',
        ...(after ? { after } : {}),
      });
      if (!result.ok || !Array.isArray(result.data.data))
        throw new Error('SUBSCRIPTION_UNVERIFIED');
      rows.push(...result.data.data.map(object));
      const paging = object(result.data.paging);
      if (!paging.next) return rows;
      const cursor = object(paging.cursors).after;
      if (typeof cursor !== 'string' || !cursor || cursor === after) break;
      after = cursor;
    }
    throw new Error('SUBSCRIPTION_INCOMPLETE');
  }

  async evidence(pageId: string, refresh = false): Promise<FacebookCommentEvidence> {
    const c = await this.credentials(pageId);
    if (!c)
      return {
        graphVersion: GRAPH_VERSION,
        verified: false,
        reason:
          'ตั้งค่า Page ID, App ID, Page Access Token, App Secret และ Webhook Verify Token ให้ครบ',
      };
    const key = createHash('sha256').update(JSON.stringify(c)).digest('hex');
    if (!refresh && this.cache?.key === key && this.cache.until > Date.now())
      return this.cache.value;
    const value = this.inspect(c).catch(() => ({
      graphVersion: GRAPH_VERSION,
      verified: false,
      reason: 'ตรวจสิทธิ์กับ Meta ไม่สำเร็จ กรุณาลองตรวจอีกครั้ง',
    }));
    this.cache = { key, until: Date.now() + 30_000, value };
    return value;
  }

  private async inspect(c: Credentials): Promise<FacebookCommentEvidence> {
    const [debug, identity, subscriptions] = await Promise.all([
      this.request(c, 'debug_token', { input_token: c.token }, undefined, true),
      this.request(c, 'me', { fields: 'id' }),
      this.subscriptions(c).catch(() => null),
    ]);
    const token = object(debug.data.data);
    const now = Math.floor(Date.now() / 1000);
    const validExpiry = (value: unknown) =>
      typeof value === 'number' && (value === 0 || value > now);
    const valid =
      debug.ok &&
      identity.ok &&
      identity.data.id === c.pageId &&
      token.is_valid === true &&
      token.app_id === c.appId &&
      token.type === 'PAGE' &&
      token.profile_id === c.pageId &&
      validExpiry(token.expires_at) &&
      validExpiry(token.data_access_expires_at);
    const scopes = Array.isArray(token.scopes) ? token.scopes : [];
    const granular = Array.isArray(token.granular_scopes) ? token.granular_scopes.map(object) : [];
    const has = (scope: string) =>
      valid &&
      scopes.includes(scope) &&
      granular
        .filter((s) => s.scope === scope)
        .every(
          (s) =>
            s.target_ids === undefined ||
            (Array.isArray(s.target_ids) && s.target_ids.includes(c.pageId)),
        );
    const app = subscriptions?.find((row) => row.id === c.appId);
    const feed = Array.isArray(app?.subscribed_fields) && app.subscribed_fields.includes('feed');
    const checks = [
      { key: 'identity', label: 'Token ของ Page และแอปนี้ยังใช้งานได้', passed: valid },
      {
        key: 'pages_read_engagement',
        label: 'สิทธิ์อ่านโพสต์และการมีส่วนร่วม (pages_read_engagement)',
        passed: has('pages_read_engagement'),
      },
      {
        key: 'pages_read_user_content',
        label: 'สิทธิ์อ่านคอมเมนต์ลูกค้า (pages_read_user_content)',
        passed: has('pages_read_user_content'),
      },
      {
        key: 'pages_manage_metadata',
        label: 'สิทธิ์จัดการการรับเหตุการณ์ (pages_manage_metadata)',
        passed: has('pages_manage_metadata'),
      },
      {
        key: 'feed',
        label:
          subscriptions === null
            ? 'ตรวจการรับเหตุการณ์ feed จาก Meta ให้สำเร็จ'
            : 'แอปสมัครรับเหตุการณ์ feed ของ Page แล้ว',
        passed: feed,
      },
      {
        key: 'pages_manage_engagement',
        label: 'สิทธิ์ตอบคอมเมนต์ (pages_manage_engagement)',
        passed: has('pages_manage_engagement'),
      },
    ];
    const receive = checks.slice(0, 5).every((check) => check.passed);
    const publicReply = receive && has('pages_manage_engagement');
    return {
      graphVersion: GRAPH_VERSION,
      verified: valid,
      receive,
      publicReply,
      privateReply: false,
      checks,
      reason: checks.every((check) => check.passed)
        ? null
        : `ยังไม่พร้อม: ${checks
            .filter((check) => !check.passed)
            .map((check) => check.label)
            .join(' · ')}`,
    };
  }

  /** Called only by the explicit OWNER setup action. Keep existing fields and Messenger defaults. */
  async subscribeFeed(pageId: string): Promise<void> {
    return this.subscribeFields(pageId, 'feed');
  }

  /** Shared with the existing Integration Hub writer so it cannot silently remove feed. */
  async subscribeFields(pageId: string, extraFields: string): Promise<void> {
    try {
      const c = await this.credentials(pageId);
      if (!c) throw new Error('MISSING_CONFIG');
      const evidence = await this.evidence(pageId, true);
      if (!evidence.checks?.find((check) => check.key === 'pages_manage_metadata')?.passed)
        throw new Error('MISSING_PERMISSION');
      const apps = await this.subscriptions(c);
      const current = apps.find((app) => app.id === c.appId);
      if (
        current &&
        (!Array.isArray(current.subscribed_fields) ||
          current.subscribed_fields.some((field) => typeof field !== 'string'))
      )
        throw new Error('INCOMPLETE_FIELDS');
      const fields = (current?.subscribed_fields ?? []) as string[];
      const result = await this.request(
        c,
        `${c.pageId}/subscribed_apps`,
        {},
        {
          subscribed_fields: withRequiredFacebookPageFields([...fields, extraFields].join(',')),
        },
      );
      this.cache = undefined;
      if (!result.ok || result.data.success !== true) throw new Error('UNCONFIRMED');
    } catch {
      this.cache = undefined;
      throw new BadRequestException(
        'ยังยืนยันการสมัครรับคอมเมนต์ไม่ได้ ตรวจสิทธิ์ Meta แล้วกดตรวจอีกครั้ง',
      );
    }
  }

  private async comment(c: Credentials, commentId: string): Promise<Json | null> {
    if (!ID.test(commentId) || commentId.length > 256) return null;
    const result = await this.request(c, encodeURIComponent(commentId), {
      fields: 'id,message,from,parent,object,created_time,can_comment',
    });
    if (!result.ok || result.data.id !== commentId) return null;
    const postId = object(result.data.object).id;
    if (typeof postId !== 'string' || !ID.test(postId) || postId.length > 256) return null;
    const post = await this.request(c, encodeURIComponent(postId), { fields: 'id,from' });
    // A token can see public objects outside this Page. Reading successfully is not ownership proof.
    return post.ok && post.data.id === postId && object(post.data.from).id === c.pageId
      ? result.data
      : null;
  }

  async readComment(pageId: string, commentId: string) {
    const c = await this.credentials(pageId);
    const row = c ? await this.comment(c, commentId) : null;
    if (!row || typeof row.message !== 'string') return null;
    // Graph visibility/permission errors do not prove deletion. Webhook REMOVE owns tombstones.
    // created_time is not an edit revision; always reconcile through an authoritative read.
    const author = object(row.from);
    const parent = object(row.parent).id;
    return {
      commentId,
      exists: true,
      text: row.message,
      revision: null,
      postId: object(row.object).id as string,
      ...(row.parent === undefined || row.parent === null
        ? { parentCommentId: null }
        : typeof parent === 'string'
          ? { parentCommentId: parent }
          : {}),
      ...(typeof author.id === 'string' ? { authorId: author.id } : {}),
      authorName: typeof author.name === 'string' ? author.name.slice(0, 255) : null,
    };
  }

  async readReply(pageId: string, externalId: string) {
    const c = await this.credentials(pageId);
    const row = c ? await this.comment(c, externalId) : null;
    const parent = object(row?.parent).id;
    if (
      !row ||
      object(row.from).id !== pageId ||
      typeof row.message !== 'string' ||
      typeof parent !== 'string' ||
      typeof row.created_time !== 'string' ||
      !Number.isFinite(Date.parse(row.created_time))
    )
      return null;
    return {
      pageId,
      externalId,
      parentCommentId: parent,
      authorId: pageId,
      text: row.message,
      createdAt: row.created_time,
    };
  }

  async replyPublic(input: PublicCommentInput) {
    const c = await this.credentials(input.pageId);
    if (!c || !input.text.trim() || input.text.length > 5000)
      return { definitelyNotSent: true, errorCode: 'PERMISSION_DENIED' };
    // A failed preflight happens before POST, so it is safe to report a rejected attempt.
    try {
      const row = await this.comment(c, input.commentId);
      if (!row || row.can_comment !== true)
        return { definitelyNotSent: true, errorCode: 'PERMISSION_DENIED' };
    } catch {
      return { definitelyNotSent: true, errorCode: 'PROVIDER_REJECTED' };
    }
    const result = await this.request(
      c,
      `${encodeURIComponent(input.commentId)}/comments`,
      {},
      { message: input.text },
    );
    if (
      result.ok &&
      typeof result.data.id === 'string' &&
      ID.test(result.data.id) &&
      result.data.id.length <= 256
    )
      return { externalId: result.data.id };
    const error = object(result.data.error);
    // Only explicit non-transient authorization/rate rejections prove no delivery. 5xx, malformed
    // acknowledgements and all ambiguous errors remain UNKNOWN; no automatic resend.
    if (result.status >= 400 && result.status < 500 && error.is_transient !== true) {
      const codes: Record<number, string> = {
        190: 'TOKEN_EXPIRED',
        10: 'PERMISSION_DENIED',
        200: 'PERMISSION_DENIED',
        4: 'RATE_LIMIT',
        17: 'RATE_LIMIT',
        32: 'RATE_LIMIT',
        613: 'RATE_LIMIT',
      };
      const code = typeof error.code === 'number' ? codes[error.code] : undefined;
      if (code) return { definitelyNotSent: true, errorCode: code };
    }
    return {};
  }
}
