import { Inject, Injectable, Optional } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { capabilityFromEvidence, FacebookCommentEvidence } from './facebook-comment-capability';
export const FACEBOOK_COMMENT_TRANSPORT = Symbol('FACEBOOK_COMMENT_TRANSPORT');
export interface PublicCommentInput {
  pageId: string;
  commentId: string;
  text: string;
}
export interface FacebookCommentSnapshot {
  commentId: string;
  exists: boolean;
  text: string | null;
  /** Only a provider-proven monotonic revision, never arrival time. */
  revision: string | null;
}
/** A verified live HTTP mapping is deliberately absent until the capability checklist passes.
 * The isolated preview binds a synthetic port; no frontend/config boolean can enable a live port. */
export interface FacebookCommentReplyProof {
  pageId: string;
  externalId: string;
  parentCommentId: string;
  authorId: string;
  text: string;
  createdAt: string;
}
export interface FacebookCommentTransport {
  readReply?(pageId: string, externalId: string): Promise<FacebookCommentReplyProof | null>;
  readRevision?(value: Record<string, unknown>): string | null;
  evidence(pageId: string): Promise<FacebookCommentEvidence>;
  replyPublic(
    input: PublicCommentInput,
  ): Promise<{ externalId?: string; definitelyNotSent?: boolean; errorCode?: string }>;
  readComment(pageId: string, commentId: string): Promise<FacebookCommentSnapshot | null>;
}
export type FacebookCommentSendResult =
  | { status: 'CONFIRMED'; externalId: string }
  | { status: 'FAILED' | 'UNKNOWN'; errorCode: string };
@Injectable()
export class FacebookCommentClient {
  constructor(
    private readonly config: IntegrationConfigService,
    @Optional()
    @Inject(FACEBOOK_COMMENT_TRANSPORT)
    private readonly transport?: FacebookCommentTransport,
  ) {}
  async configuredPageId() {
    const config = await this.config.getConfig('facebook');
    return typeof config.pageId === 'string' && config.pageId.length <= 128 ? config.pageId : null;
  }
  async getCapabilities(pageId: string) {
    const closed = () => capabilityFromEvidence({ graphVersion: 'v25.0', verified: false });
    try {
      const config = await this.config.getConfig('facebook');
      if (!pageId || config.pageId !== pageId || !config.pageAccessToken || !this.transport)
        return closed();
      return capabilityFromEvidence(await this.transport.evidence(pageId));
    } catch {
      return closed();
    }
  }
  async replyPublic(input: PublicCommentInput): Promise<FacebookCommentSendResult> {
    const capabilities = await this.getCapabilities(input.pageId);
    if (!capabilities.publicReply || !this.transport)
      return { status: 'FAILED', errorCode: 'CAPABILITY_UNVERIFIED' };
    if (!input.commentId || !input.text.trim())
      return { status: 'FAILED', errorCode: 'INVALID_INPUT' };
    try {
      const result = await this.transport.replyPublic(input);
      if (
        typeof result.externalId === 'string' &&
        result.externalId.trim() &&
        result.externalId.length <= 256
      )
        return { status: 'CONFIRMED', externalId: result.externalId };
      const code = ['TOKEN_EXPIRED', 'RATE_LIMIT', 'PERMISSION_DENIED', 'COMMENT_DELETED'].includes(
        result.errorCode ?? '',
      )
        ? result.errorCode!
        : 'PROVIDER_REJECTED';
      if (result.definitelyNotSent) return { status: 'FAILED', errorCode: code };
      return { status: 'UNKNOWN', errorCode: 'MISSING_ACK' };
    } catch {
      return { status: 'UNKNOWN', errorCode: 'TRANSPORT_UNCERTAIN' };
    }
  }
  revisionOf(value: Record<string, unknown>): string | null {
    try {
      const revision = this.transport?.readRevision?.(value);
      return typeof revision === 'string' && /^\d{1,38}$/.test(revision)
        ? BigInt(revision).toString()
        : null;
    } catch {
      return null;
    }
  }
  async readReply(pageId: string, externalId: string): Promise<FacebookCommentReplyProof | null> {
    if (!(await this.getCapabilities(pageId)).receive || !this.transport?.readReply) return null;
    try {
      const proof = await this.transport.readReply(pageId, externalId);
      if (
        !proof ||
        proof.pageId !== pageId ||
        proof.externalId !== externalId ||
        proof.authorId !== pageId ||
        typeof proof.text !== 'string' ||
        !Number.isFinite(Date.parse(proof.createdAt))
      )
        return null;
      return proof;
    } catch {
      return null;
    }
  }
  async readComment(pageId: string, commentId: string): Promise<FacebookCommentSnapshot | null> {
    if (!(await this.getCapabilities(pageId)).receive || !this.transport) return null;
    try {
      const snapshot = await this.transport.readComment(pageId, commentId);
      if (
        !snapshot ||
        snapshot.commentId !== commentId ||
        typeof snapshot.exists !== 'boolean' ||
        (snapshot.text !== null && typeof snapshot.text !== 'string') ||
        (snapshot.revision !== null &&
          (typeof snapshot.revision !== 'string' || !/^\d{1,38}$/.test(snapshot.revision)))
      )
        return null;
      return {
        ...snapshot,
        text: snapshot.text?.slice(0, 20000) ?? null,
        revision: snapshot.revision === null ? null : BigInt(snapshot.revision).toString(),
      };
    } catch {
      return null;
    }
  }
}
