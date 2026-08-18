import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel, MessageRole, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  InboundMessage,
  OutboundMessage,
  OutboundQuickReply,
  CHANNEL_ADAPTER_TOKEN,
} from '../interfaces/channel-adapter.interface';
import {
  IDomainHandler,
  DomainContext,
  DOMAIN_HANDLER_TOKEN,
} from '../interfaces/domain-handler.interface';
import { RoomManagerService } from './room-manager.service';
import { HandoffManagerService } from './handoff-manager.service';
import { AfterHoursService } from './after-hours.service';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';
import { AiAutoReplyService } from '../../staff-chat/services/ai-auto-reply.service';
import { MAX_BOT_ATTACHMENTS } from '../../../utils/bot-attachments.util';

/**
 * MessageRouter — the central nerve of the chat engine.
 *
 * Receives normalized InboundMessages from channel adapters and routes them:
 * 1. If room is in handoff → skip AI, store message, notify staff via WS
 * 2. If room is active → find domain handler → get AI reply → send through adapter
 * 3. Handles room creation, message persistence, SLA tracking
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);
  private readonly adapterMap = new Map<ChatChannel, IChannelAdapter>();
  private readonly domainHandlers: IDomainHandler[] = [];

  constructor(
    private roomManager: RoomManagerService,
    private handoffManager: HandoffManagerService,
    private configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => AfterHoursService))
    private afterHoursService?: AfterHoursService,
    @Optional()
    private aiAutoReplyService?: AiAutoReplyService,
    @Optional()
    @Inject(CHANNEL_ADAPTER_TOKEN)
    adapters?: IChannelAdapter[],
    @Optional()
    @Inject(DOMAIN_HANDLER_TOKEN)
    handlers?: IDomainHandler[],
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private gateway?: IChatGateway,
  ) {
    // Register adapters by channel (via constructor — only works when ChatEngineModule
    // imports a module that exports CHANNEL_ADAPTER_TOKEN. For the current wiring where
    // ChatAdaptersModule imports ChatEngineModule instead, adapters self-register via
    // registerAdapter() in ChatAdaptersModule.onModuleInit().)
    if (adapters) {
      for (const adapter of Array.isArray(adapters) ? adapters : [adapters]) {
        this.registerAdapter(adapter);
      }
    }

    if (handlers) {
      for (const handler of Array.isArray(handlers) ? handlers : [handlers]) {
        this.registerDomainHandler(handler);
      }
    }
  }

  /**
   * Register a channel adapter. Idempotent — safe to call from module init hooks
   * when the DI token-based registration isn't reachable due to module scope.
   */
  registerAdapter(adapter: IChannelAdapter): void {
    const existing = this.adapterMap.get(adapter.channel);
    if (existing === adapter) return;
    this.adapterMap.set(adapter.channel, adapter);
    this.logger.log(`Registered adapter: ${adapter.channel}`);
  }

  registerDomainHandler(handler: IDomainHandler): void {
    if (this.domainHandlers.includes(handler)) return;
    this.domainHandlers.push(handler);
    this.logger.log(`Registered domain handler (${this.domainHandlers.length} total)`);
  }

  /**
   * Route an inbound message through the engine pipeline.
   *
   * Pipeline:
   * 1. Get/create room
   * 2. Save inbound message
   * 3. Check handoff mode → if yes, only notify staff
   * 3.5. Check AI auto-reply → if confident, send and return; if not, handoff
   * 4. Check after-hours → if yes, auto-reply and return
   * 5. Find domain handler for channel
   * 6. Process message → get reply
   * 7. Send reply through adapter
   * 8. Save outbound message
   */
  /**
   * คิวประมวลผลต่อ (channel, ลูกค้า) — ลูกค้าพิมพ์รัวหลายข้อความติดกันคือ webhook
   * หลายลูกวิ่งขนาน → AI หลายเทิร์นซ้อนในห้องเดียว (ตอบสลับลำดับ, เทิร์นหลังไม่เห็น
   * คำตอบเทิร์นแรกใน history, จ่ายโทเคนคูณ) — จับเรียงเป็นลูกโซ่ต่อคีย์เดียวกัน
   */
  private readonly inboundChains = new Map<string, Promise<unknown>>();

  /**
   * รวมข้อความที่ลูกค้าพิมพ์ติดกันให้เป็นเทิร์นเดียว (coalesce)
   *
   * คนไทยแชทจริงพิมพ์รัวเป็นท่อน ๆ ("แล้วเครื่องจะออกก่อนไหม" / "อีกตั้งครึ่งเดือน")
   * — เดิมนับเป็น 2 เทิร์น บอทจึงตอบ 2 ชุดติดกัน (เห็นจริงในแชทลูกค้า 2026-08-17)
   * คิว inboundChains กันตอบ "พร้อมกัน" ได้ แต่ไม่ได้กันตอบ "สองครั้ง"
   *
   * วิธีแก้: ทุกข้อความรับตั๋วเรียงลำดับต่อลูกค้า → ก่อนเรียก AI รอ DEBOUNCE
   * แล้วเช็คว่าตั๋วตัวเองยังเป็นใบล่าสุดไหม ถ้าไม่ใช่ = ลูกค้าพิมพ์ต่อ ให้ข้ามการตอบ
   * (ข้อความยังถูกบันทึก + ขึ้น inbox ตามปกติ และเทิร์นล่าสุดเห็นทุกข้อความใน history)
   */
  private readonly inboundTickets = new Map<string, number>();
  private inboundSeq = 0;
  /**
   * 3 วิ — ยาวพอให้พิมพ์ท่อนถัดไปจบ สั้นพอไม่รู้สึกว่าบอทอืด (มี typing indicator คั่นแล้ว)
   * ปรับได้ด้วย env CHAT_COALESCE_MS โดยไม่ต้องแก้โค้ด (0 = ปิดการรอ)
   */
  private static get coalesceWindowMs(): number {
    const v = Number(process.env.CHAT_COALESCE_MS);
    return Number.isFinite(v) && v >= 0 ? v : 3000;
  }

  async routeInbound(message: InboundMessage): Promise<void> {
    const chainKey = `${message.channel}:${message.externalUserId}`;
    // ออกตั๋วตั้งแต่ "รับเข้า" (ไม่ใช่ตอนถึงคิว) เพื่อให้เทิร์นที่กำลังรออยู่รู้ทันทีว่ามีข้อความใหม่
    const ticket = ++this.inboundSeq;
    this.inboundTickets.set(chainKey, ticket);
    const prev = this.inboundChains.get(chainKey) ?? Promise.resolve();
    const run = prev.then(() => this.routeInboundInner(message, chainKey, ticket));
    // เก็บลง map แบบกลืน error — เทิร์นถัดไปต้องไม่ตายตามเทิร์นก่อนหน้า
    const settled = run.catch(() => undefined);
    this.inboundChains.set(chainKey, settled);
    void settled.then(() => {
      if (this.inboundChains.get(chainKey) === settled) this.inboundChains.delete(chainKey);
    });
    return run;
  }

  private async routeInboundInner(
    message: InboundMessage,
    chainKey?: string,
    ticket?: number,
  ): Promise<void> {
    // 0. Best-effort profile fetch — never block webhook on profile API issues
    const adapter = this.adapterMap.get(message.channel);
    let profile: { displayName?: string; avatarUrl?: string } | null = null;
    if (adapter?.getUserProfile) {
      try {
        profile = await adapter.getUserProfile(message.externalUserId);
      } catch (err) {
        this.logger.warn(
          `[${message.channel}] profile fetch threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 1. Get or create room
    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: message.externalUserId,
      channel: message.channel,
      displayName: profile?.displayName,
      pictureUrl: profile?.avatarUrl,
      attribution: message.attribution,
    });

    // 2. Save inbound message
    await this.roomManager.saveMessage({
      roomId: room.id,
      externalMessageId: message.externalMessageId,
      role: MessageRole.CUSTOMER,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    });

    // 3. Notify staff inbox of every inbound customer message (real-time room list refresh)
    this.gateway?.emitNewMessage(room.id, {
      role: 'CUSTOMER',
      text: message.text,
      type: message.type,
      channel: message.channel,
      roomId: room.id,
    });

    // 3a. Global FB kill switch — stop ALL bot pathways (welcome, AI, after-hours)
    // when FB_BOT_DISABLED=true. Inbound is still saved and staff are notified above.
    // FB_BOT_WHITELIST_PSIDS (comma-separated) bypasses the kill switch for staged testing.
    if (
      message.channel === ChatChannel.FACEBOOK &&
      this.configService.get<string>('FB_BOT_DISABLED') === 'true'
    ) {
      // split on , or ; — the deploy workflow's --set-env-vars uses commas as the
      // PAIR separator, so the whitelist value itself must use semicolons there
      const whitelist = (this.configService.get<string>('FB_BOT_WHITELIST_PSIDS') ?? '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!whitelist.includes(message.externalUserId ?? '')) {
        this.logger.log(
          `[FbBotKillSwitch] room=${room.id} psid=${message.externalUserId} not in whitelist=${JSON.stringify(whitelist)} — skipped`,
        );
        return;
      }
    }

    // 3b. Check handoff mode — if staff is handling, don't run AI
    if (room.handoffMode) {
      this.logger.debug(`Room ${room.id} in handoff mode — skipping AI processing`);
      return;
    }

    // 3.5 AI auto-reply — runs when auto mode is enabled for the room channel
    // รอให้ลูกค้าพิมพ์จบก่อนค่อยตอบ — ยิง typing indicator ก่อนเข้าโหมดรอ เพื่อให้ลูกค้า
    // เห็นว่ากำลังตอบอยู่ (ไม่รู้สึกว่าเงียบ) แล้วค่อยเช็คว่ามีข้อความใหม่ตามมาไหม
    if (chainKey && ticket !== undefined && this.aiAutoReplyService) {
      if (message.externalUserId) {
        void this.adapterMap
          .get(message.channel)
          ?.sendTypingIndicator?.(message.externalUserId)
          ?.catch(() => undefined);
      }
      const waitMs = MessageRouterService.coalesceWindowMs;
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      if (this.inboundTickets.get(chainKey) !== ticket) {
        this.logger.log(
          `[Coalesce] room=${room.id} ข้ามการตอบข้อความนี้ — ลูกค้าพิมพ์ต่อ เทิร์นล่าสุดจะตอบรวมให้`,
        );
        return;
      }
    }

    if (this.aiAutoReplyService && (await this.aiAutoReplyService.shouldAutoReply(room))) {
      // ข้อความไม่มี text (รูป/สติกเกอร์/เสียง/วิดีโอ/ไฟล์) ห้ามส่ง '' เข้า Claude —
      // API ปฏิเสธ text block ว่าง → ลูกค้าเห็น "กำลังพิมพ์" แล้วเงียบ/หลุดไปข้อความยืนยันตัวตน
      // สำคัญสุดกับขั้นรับเอกสาร: ลูกค้าส่งรูปสเตทเม้นท์ = IMAGE → บอทต้องตอบรับแล้วเดินขั้นถัดไป
      const customerMessage =
        message.text ?? MessageRouterService.describeNonTextInbound(message.type);
      try {
        // "กำลังพิมพ์..." ทันทีที่เริ่มคิด — Sonnet 5 ใช้เวลาคิด 10-30s ต่อเทิร์น
        // ลูกค้าต้องเห็นว่าบอทกำลังตอบอยู่ ไม่ใช่เงียบ (best-effort, FB เท่านั้นที่รองรับ)
        if (message.externalUserId) {
          void this.adapterMap
            .get(message.channel)
            ?.sendTypingIndicator?.(message.externalUserId)
            ?.catch(() => undefined);
        }
        const result = await this.aiAutoReplyService.autoReply(room.id, customerMessage);

        // เทิร์น LLM กิน 10-30s — พนักงานอาจ takeover (aiPaused) หรือห้องเข้าสถานะ
        // handoff ระหว่างที่บอทคิด: อ่านสถานะสดอีกครั้งก่อนส่ง ไม่งั้นบอทยิงคำตอบ
        // ทับหลังพนักงานที่เพิ่งตอบไป (คำตอบไม่หาย — เก็บใน log autoSent=false)
        if (result !== null) {
          const fresh = await this.roomManager.findById(room.id);
          if (fresh?.aiPaused || fresh?.handoffMode) {
            await this.aiAutoReplyService.logAutoReply({
              roomId: room.id,
              customerMessage,
              aiReply: result.reply,
              confidence: result.confidence,
              autoSent: false,
              handoffReason: 'พนักงาน takeover ระหว่างบอทกำลังคิด',
              toolsUsed: result.toolsUsed,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            });
            this.logger.log(`[AiAutoReply] Suppressed reply for room ${room.id} — staff took over mid-turn`);
            return;
          }
        }

        if (result !== null) {
          // AI is confident — send reply and skip further processing
          const adapter = this.adapterMap.get(message.channel);
          if (adapter) {
            // "[ตัวเลือก: a | b | c]" ท้ายข้อความ → ปุ่มกดตอบ (quick replies) บนบับเบิลสุดท้าย
            // กดแล้วส่งข้อความนั้นแทนลูกค้า — persona สั่งให้แนบเมื่อคำถามมีตัวเลือกชัด
            let quickReplies: OutboundQuickReply[] | undefined;
            let replyText = result.reply;
            const qrMatch = replyText.match(/\n?\s*\[ตัวเลือก:\s*([^\]]+)\]\s*$/);
            if (qrMatch) {
              replyText = replyText.slice(0, qrMatch.index).trimEnd();
              quickReplies = qrMatch[1]
                .split('|')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 13)
                .map((label) => ({
                  // FB จำกัด label 20 ตัวอักษร แต่ข้อความที่ส่งเมื่อกดใช้ตัวเต็ม
                  label: label.slice(0, 20),
                  type: 'MESSAGE' as const,
                  message: label,
                }));
            }
            // บอทคั่นก้อนข้อความด้วยบรรทัด "---" (persona: ก้อนข้อมูลก่อน ปิดด้วยก้อนคำถามเดียว)
            // → ส่งเป็นคนละข้อความต่อกันเหมือนคนพิมจริง; ไม่มีตัวคั่น = ส่งเดียวตามเดิม
            // replyToken (LINE) ใช้ได้ครั้งเดียว — ใส่เฉพาะบับเบิลแรก ที่เหลือ push
            const bubbles = replyText
              .split(/\n\s*---+\s*\n/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 4);
            const parts = bubbles.length > 0 ? bubbles : [replyText];
            // FB อาจปฏิเสธการส่ง (rate limit/ลูกค้าบล็อกเพจ/token) — เดิมไม่เช็คผลเลย
            // ระบบบันทึกเหมือนส่งสำเร็จทั้งที่ลูกค้าไม่ได้อะไร; ตอนนี้ bubble แรกล่ม =
            // นับว่าเทิร์นล่ม → ปักธงพนักงาน, bubble หลังล่ม = ตัดที่เหลือทิ้ง (แรกถึงแล้ว)
            let firstBubbleFailed = false;
            for (let i = 0; i < parts.length; i++) {
              // 350ms (เดิม 700): ยังได้จังหวะ "คนทยอยพิมพ์" แต่เทิร์น 4 ก้อนประหยัด ~1 วิ
              if (i > 0) await new Promise((r) => setTimeout(r, 350));
              const sendResult = await adapter.sendMessage({
                externalUserId: message.externalUserId,
                channel: message.channel,
                type: 'TEXT' as any,
                text: parts[i],
                replyToken: i === 0 ? message.replyToken : undefined,
                // ปุ่มกดต้องอยู่ข้อความสุดท้าย (FB/LINE แสดง quick reply เฉพาะข้อความล่าสุด)
                ...(i === parts.length - 1 && quickReplies ? { quickReplies } : {}),
              });
              if (sendResult && sendResult.success === false) {
                this.logger.error(
                  `[AiAutoReply] ส่ง bubble ${i + 1}/${parts.length} ไม่สำเร็จ room=${room.id}: ${sendResult.error ?? 'unknown'}`,
                );
                if (i === 0) firstBubbleFailed = true;
                break;
              }
              await this.roomManager.saveMessage({
                roomId: room.id,
                role: MessageRole.BOT,
                text: parts[i],
                intent: 'AUTO:sales', // Phase A: SHOP channels always sales (intent router skipped)
                // token/tool stats เก็บที่บับเบิลแรกใบเดียว — กันนับซ้ำในรายงาน
                ...(i === 0
                  ? {
                      toolsUsed: result.toolsUsed,
                      inputTokens: result.inputTokens,
                      outputTokens: result.outputTokens,
                    }
                  : {}),
              });
            }
            if (firstBubbleFailed) {
              // ลูกค้าไม่ได้รับอะไรเลย — บันทึกตามจริง + ปักธงให้พนักงานตามต่อ
              await this.aiAutoReplyService.logAutoReply({
                roomId: room.id,
                customerMessage,
                aiReply: result.reply,
                confidence: result.confidence,
                autoSent: false,
                handoffReason: 'ส่งข้อความไม่สำเร็จ (channel error)',
                toolsUsed: result.toolsUsed,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              });
              await this.handoffManager.initiateHandoff({
                roomId: room.id,
                reason: 'ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า',
                priority: 'normal',
                summary: customerMessage,
              });
              return;
            }
            // B3 §5 — ส่งรูปสินค้าตามหลังข้อความ (best-effort)
            await this.sendBotAttachments(adapter, message, room.id, result.attachments);
          }
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: result.reply,
            confidence: result.confidence,
            autoSent: true,
            intent: 'AUTO:sales',
            toolsUsed: result.toolsUsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
          // #1332 auto-handoff หลังตอบเรทถูกถอดออก (2026-08-14): เดิมเรทกลางเป็น
          // fallback หายาก จึงปักธง+ปิดปากบอทให้พนักงานตามต่อ — แต่หลัง seed
          // pricing_templates จริง get_installment_rates กลายเป็นเครื่องมือหลัก
          // ของการเสนอราคา ปักธงทุกครั้ง = บอทเงียบถาวรหลังเสนอเรทครั้งแรก
          // การส่งต่อพนักงานตอนนี้เกิดที่จังหวะที่ถูกต้องแทน: capture_lead /
          // handoff_to_human ซึ่ง set handoffMode เองเมื่อบอทเก็บ lead สำเร็จ
          this.logger.log(
            `[AiAutoReply] Replied to room ${room.id} with confidence=${result.confidence}`,
          );
          return;
        } else {
          // AI not confident — initiate handoff to staff
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: '',
            confidence: 0,
            autoSent: false,
            handoffReason: 'ความมั่นใจของ AI ต่ำกว่า threshold',
          });
          // บอกลูกค้าก่อนเงียบ — ไม่งั้นเห็น "กำลังพิมพ์..." แล้วหายไปเฉย ๆ
          const lowConfMsg = 'อันนี้เดี๋ยวแอดมินเข้ามาตอบให้นะคะ รอสักครู่ค่า 🙏';
          const lowConfAdapter = this.adapterMap.get(message.channel);
          if (lowConfAdapter) {
            await lowConfAdapter.sendMessage({
              externalUserId: message.externalUserId,
              channel: message.channel,
              type: 'TEXT' as any,
              text: lowConfMsg,
              replyToken: message.replyToken,
            });
            await this.roomManager.saveMessage({
              roomId: room.id,
              role: MessageRole.BOT,
              text: lowConfMsg,
            });
          }
          await this.handoffManager.initiateHandoff({
            roomId: room.id,
            reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
            priority: 'normal',
            summary: customerMessage,
          });
          this.logger.log(`[AiAutoReply] Low confidence for room ${room.id} — initiated handoff`);
          return;
        }
      } catch (err) {
        this.logger.error(
          `[AiAutoReply] Error for room ${room.id}: ${err instanceof Error ? err.message : err}`,
        );
        // AI ล่ม: ห้ามหลุดไป domain handler — ห้อง FB ขายของส่วนใหญ่ยังไม่ verify
        // จะโดนข้อความ "ยืนยันตัวตน" ของ flow ไฟแนนซ์ซึ่งผิดเรื่อง — ขอโทษสั้น ๆ
        // + ปักธงให้พนักงานเห็นในคิว "ต้องตอบ" แล้วจบเทิร์น
        try {
          const errAdapter = this.adapterMap.get(message.channel);
          if (errAdapter) {
            const apology = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว เดี๋ยวแอดมินเข้ามาดูแลต่อให้นะคะ 🙏';
            await errAdapter.sendMessage({
              externalUserId: message.externalUserId,
              channel: message.channel,
              type: 'TEXT' as any,
              text: apology,
              replyToken: message.replyToken,
            });
            await this.roomManager.saveMessage({
              roomId: room.id,
              role: MessageRole.BOT,
              text: apology,
            });
          }
          await this.handoffManager.initiateHandoff({
            roomId: room.id,
            reason: 'ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน',
            priority: 'normal',
            summary: message.text ?? '(ข้อความไม่มีตัวอักษร)',
          });
        } catch (innerErr) {
          this.logger.error(
            `[AiAutoReply] Fallback notify failed for room ${room.id}: ${innerErr instanceof Error ? innerErr.message : innerErr}`,
          );
        }
        return;
      }
    }

    // 4. After-hours auto-reply (only reached when AI auto mode is off/skipped)
    if (this.afterHoursService?.isAfterHours() && !room.handoffMode && !room.aiPaused) {
      try {
        const reply = await this.afterHoursService.getAutoReply(message.text ?? '');
        const adapter = this.adapterMap.get(message.channel);
        if (adapter) {
          await adapter.sendMessage({
            externalUserId: message.externalUserId,
            channel: message.channel,
            type: 'TEXT' as any,
            text: reply,
            replyToken: message.replyToken,
          });
          await this.roomManager.saveMessage({
            roomId: room.id,
            role: MessageRole.BOT,
            text: reply,
          });
        }
        this.logger.log(`[AfterHours] Auto-replied to room ${room.id}`);
        return;
      } catch (err) {
        this.logger.error(`[AfterHours] Error: ${err instanceof Error ? err.message : err}`);
        // Fall through to normal processing
      }
    }

    // 4. Find domain handler
    const handler = this.findDomainHandler(message.channel);
    if (!handler) {
      this.logger.warn(
        `No domain handler for channel ${message.channel} — message stored but not processed`,
      );
      return;
    }

    // 5. Build context and process
    const context: DomainContext = {
      room,
      message,
      isVerified: !!room.verifiedAt,
      isHandoff: room.handoffMode,
    };

    try {
      const result = await handler.handleMessage(context);

      // 6. Handle handoff request from domain handler
      if (result.shouldHandoff) {
        await this.handoffManager.initiateHandoff({
          roomId: room.id,
          reason: result.handoffReason ?? 'ลูกค้าขอพูดกับพนักงาน',
          priority: result.handoffPriority ?? 'normal',
          summary: message.text ?? '(media message)',
        });
      }

      // 7. Send replies through adapter and save them
      const adapter = this.adapterMap.get(message.channel);
      if (adapter && result.replies.length > 0) {
        for (const [i, reply] of result.replies.entries()) {
          const sendResult = await adapter.sendMessage({
            ...reply,
            replyToken: i === 0 ? message.replyToken : undefined,
          });

          await this.roomManager.saveMessage({
            roomId: room.id,
            externalMessageId: sendResult.externalMessageId,
            role: MessageRole.BOT,
            type: reply.type,
            text: reply.text,
          });

          if (!sendResult.success) {
            this.logger.error(`Failed to send reply on ${message.channel}: ${sendResult.error}`);
          }
        }
      }

      // 8. Apply tags from domain handler
      if (result.tags?.length) {
        // Tags will be handled by ConversationTagService
        // For now, just log
        this.logger.debug(`Tags suggested for room ${room.id}: ${result.tags.join(', ')}`);
      }
    } catch (err) {
      this.logger.error(
        `Error processing message for room ${room.id}: ${err instanceof Error ? err.message : err}`,
      );
      // Don't throw — message is already saved, failure is logged
    }
  }

  /**
   * Mirror an inbound message to ChatRoom/ChatMessage only — no AI, no
   * after-hours, no domain handler dispatch. Used by channel handlers that
   * own their own reply logic (e.g. Shop command-based bot) but want their
   * conversations visible in the Unified Inbox with platform profile.
   */
  async mirrorInbound(message: InboundMessage): Promise<void> {
    const adapter = this.adapterMap.get(message.channel);
    let profile: { displayName?: string; avatarUrl?: string } | null = null;
    if (adapter?.getUserProfile) {
      try {
        profile = await adapter.getUserProfile(message.externalUserId);
      } catch (err) {
        this.logger.warn(
          `[${message.channel}] profile fetch threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: message.externalUserId,
      channel: message.channel,
      displayName: profile?.displayName,
      pictureUrl: profile?.avatarUrl,
      attribution: message.attribution,
    });

    await this.roomManager.saveMessage({
      roomId: room.id,
      externalMessageId: message.externalMessageId,
      role: MessageRole.CUSTOMER,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    });

    // Emit to Unified Inbox (best-effort)
    this.gateway?.emitNewMessage(room.id, {
      role: 'CUSTOMER',
      text: message.text,
      type: message.type,
      channel: message.channel,
      roomId: room.id,
    });
  }

  /**
   * Mirror an outbound (bot/staff) message to ChatRoom — for channels that send
   * outside MessageRouter (e.g. Facebook `message_echoes` when an admin replied
   * via Meta Business Suite / Page Inbox instead of through our /chat UI).
   *
   * `externalMessageId` (if provided) carries the platform's message id (FB `mid`)
   * — relies on the UNIQUE constraint on ChatMessage.externalMessageId to
   * silently dedupe if the same echo is re-delivered.
   */
  async mirrorOutbound(params: {
    externalUserId: string;
    channel: ChatChannel;
    role: typeof MessageRole.BOT | typeof MessageRole.STAFF;
    text?: string;
    type?: MessageType;
    mediaUrl?: string;
    staffId?: string;
    externalMessageId?: string;
    /** true = echo จากแอปอื่นที่ยืนยันได้ (มี FACEBOOK_APP_ID เทียบ) → pause AI ห้องนี้ */
    pauseAi?: boolean;
  }): Promise<void> {
    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: params.externalUserId,
      channel: params.channel,
    });
    // echo STAFF จากแอปอื่น (พนักงานตอบผ่าน Meta Business Suite/แอป Page มือถือ)
    // = takeover เช่นเดียวกับพิมพ์จาก inbox — หยุด AI ห้องนี้ กันบอทแทรก
    if (params.role === MessageRole.STAFF && params.pauseAi) {
      void this.roomManager
        .pauseAiIfActive?.(room.id, params.staffId)
        ?.then((paused) => {
          if (paused) {
            this.gateway?.emitRoomUpdate(room.id, { roomId: room.id, aiPaused: true });
          }
        })
        ?.catch(() => undefined);
    }
    try {
      await this.roomManager.saveMessage({
        roomId: room.id,
        externalMessageId: params.externalMessageId,
        role: params.role,
        text: params.text,
        type: params.type,
        mediaUrl: params.mediaUrl,
        staffId: params.staffId,
      });
    } catch (err) {
      // UNIQUE violation on externalMessageId — echo replay; safe to ignore.
      const code = (err as { code?: string })?.code;
      if (params.externalMessageId && code === 'P2002') {
        this.logger.debug(`[mirrorOutbound] Duplicate echo skipped: ${params.externalMessageId}`);
        return;
      }
      throw err;
    }

    this.gateway?.emitNewMessage(room.id, {
      role: params.role === MessageRole.BOT ? 'BOT' : 'STAFF',
      text: params.text,
      type: params.type ?? MessageType.TEXT,
      channel: params.channel,
      roomId: room.id,
    });
  }

  /**
   * B3 §5 — ส่ง IMAGE bubble ตามหลังคำตอบบอท
   *
   * ต้องส่ง "หลัง" ข้อความเสมอ: LINE reply token ใช้ได้ครั้งเดียวและถูกใช้ไปกับ
   * ข้อความแรกแล้ว — bubble ถัดไปจึงไม่ส่ง replyToken (adapter จะ push ให้เอง)
   *
   * best-effort ทั้งก้อน: รูปส่งไม่ได้ต้องไม่ทำให้คำตอบที่ส่งไปแล้วกลายเป็น error
   * และต้องไม่ปล่อยให้หลุดไปเส้นทาง domain-handler (จะกลายเป็นตอบซ้ำ)
   */
  private async sendBotAttachments(
    adapter: IChannelAdapter,
    message: InboundMessage,
    roomId: string,
    attachments?: { productId: string; imageUrl?: string; webUrl?: string; label?: string }[],
  ): Promise<void> {
    if (!attachments?.length) return;
    for (const att of attachments.slice(0, MAX_BOT_ATTACHMENTS)) {
      if (!att.imageUrl) continue;
      try {
        const sendResult = await adapter.sendMessage({
          externalUserId: message.externalUserId,
          channel: message.channel,
          type: MessageType.IMAGE,
          imageUrl: att.imageUrl,
        });
        await this.roomManager.saveMessage({
          roomId,
          externalMessageId: sendResult.externalMessageId,
          role: MessageRole.BOT,
          type: MessageType.IMAGE,
          // `text` ต้องมีค่า — room-list preview อ่านจากคอลัมน์นี้ และเป็น "ความจำรูป"
          // ของบอท (ประวัติเก็บเฉพาะ text — จดชื่อรุ่นไว้ให้บอทรู้ว่าลูกค้ากำลังดูรูปอะไร)
          text: att.label ? `[รูป ${att.label}]` : '[image]',
          mediaUrl: att.imageUrl,
          intent: 'AUTO:sales:image',
        });
        if (!sendResult.success) {
          this.logger.warn(
            `[AiAutoReply] image send failed room=${roomId} product=${att.productId}: ${sendResult.error}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[AiAutoReply] image send threw room=${roomId} product=${att.productId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * Send a staff message through the appropriate adapter.
   * Idempotent on clientMessageId: if the same token is retried, the backend
   * deduplicates at the DB level so a message that was already delivered to the
   * customer is never re-sent.
   *
   * ## Idempotency state machine
   *
   * Each `clientMessageId` token drives the following states:
   *
   * 1. **No row** (fresh send):
   *    `saveMessage` → `adapter.sendMessage` → `markOutboundSent` → return success.
   *
   * 2. **Row exists, `outboundSentAt` set** (retry of a delivered message):
   *    Re-fetch by token → return success immediately. Adapter is NOT called — the
   *    customer already received the message on the winning attempt.
   *
   * 3. **Row exists, `outboundSentAt` null** (retry of an undelivered message, e.g.
   *    first attempt saved the row but the adapter call crashed or timed out):
   *    `adapter.sendMessage` is called once → on success, `markOutboundSent` stamps
   *    the row → return success. On adapter failure, `outboundSentAt` stays null so
   *    the next retry can try again.
   *
   * 4. **P2002 race** (two concurrent sends with the same token hit `saveMessage`
   *    simultaneously and only one INSERT wins):
   *    The loser's INSERT throws P2002. The loser re-fetches the row (now owned by
   *    the winner) and returns success **without** calling the adapter. The winner
   *    continues to states 2/3 above and owns delivery.
   *    This is the critical case that prevents double-delivery: before this fix,
   *    the loser would fall through to `adapter.sendMessage` in the window before
   *    the winner stamped `outboundSentAt`, sending the message twice.
   *
   * รองรับทั้ง TEXT และ IMAGE — bubble รูปใช้ `mediaUrl` (ค่าที่ persist) กับ
   * `deliveryMediaUrl` (URL ที่ส่งให้ช่องทาง เมื่อ mediaUrl เป็น storage key).
   * idempotency ทำงานเหมือนกันทั้งสองชนิดเพราะผูกกับ clientMessageId ไม่ใช่ชนิด.
   *
   * ## Accepted residual (exactly-once is impossible over an unreliable adapter)
   *
   * A crash in the narrow window between `adapter.sendMessage` returning success and
   * `markOutboundSent` completing leaves `outboundSentAt = null` on an already-delivered
   * row. A subsequent retry will re-deliver (state 3). This at-least-once residual is
   * unavoidable without a distributed 2PC protocol; it is far less common than the
   * previously-always-double-deliver-on-retry behaviour that this feature replaces.
   */
  async sendStaffMessage(params: {
    roomId: string;
    staffId: string;
    text?: string;
    clientMessageId?: string;
    /** ชนิดข้อความที่จะ persist + ส่งออก (ไม่ระบุ = TEXT) */
    type?: MessageType;
    /** ค่าที่ persist ลง ChatMessage.mediaUrl — storage key หรือ public URL */
    mediaUrl?: string;
    mediaType?: string;
    /**
     * URL ที่ส่งให้ "ช่องทาง" จริง — ใช้เมื่อค่าที่ persist เป็น storage key
     * (LINE/FB ต้องการ public HTTPS). ไม่ระบุ = ใช้ mediaUrl
     */
    deliveryMediaUrl?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: { id: string; clientMessageId: string | null; createdAt: Date };
  }> {
    if (!params.text?.trim() && !params.mediaUrl) {
      return { success: false, error: 'ไม่มีเนื้อหาที่จะส่ง' };
    }

    // Fail fast BEFORE persisting: an IMAGE whose delivery URL is a storage key
    // (or missing) would reach LINE/FB as a non-https URL, get rejected, and leave
    // the saved row stuck undelivered forever. mediaUrl may stay a storage key
    // (that's what we persist; inbox re-signs on read) — but the URL handed to the
    // channel must be public https (task-1 review I1).
    if ((params.type ?? MessageType.TEXT) === MessageType.IMAGE) {
      const candidateDeliveryUrl = params.deliveryMediaUrl ?? params.mediaUrl;
      // Positive allow-list (fix round 2): only public http(s) may reach the channel.
      // NOT `isStorageKey()` — that helper deliberately lets `line://` refs through
      // (read/sign-path semantics), but LINE cannot fetch a `line://` value either;
      // a legacy row's mediaUrl forwarded here unresolved must be rejected the same
      // way as a raw storage key.
      if (!candidateDeliveryUrl || !/^https:\/\//i.test(candidateDeliveryUrl)) {
        return {
          success: false,
          error:
            'ต้องส่ง deliveryMediaUrl เป็น public URL (https) — mediaUrl ที่เป็น storage key ใช้ส่งออกช่องทางไม่ได้',
        };
      }
    }

    const room = await this.roomManager.findById(params.roomId);
    if (!room) {
      this.logger.error(`Room not found: ${params.roomId}`);
      return { success: false, error: 'Room not found' };
    }
    const externalUserId = room.externalUserId ?? room.lineUserId ?? '';
    const adapter = this.adapterMap.get(room.channel);
    if (!adapter) {
      const error = `No adapter registered for channel ${room.channel}`;
      this.logger.error(error);
      return { success: false, error };
    }

    // พนักงานพิมพ์เอง = takeover โดยพฤตินัย — หยุด AI ห้องนี้ทันที (กันบอทแทรกกลาง
    // การเจรจา) ปลดด้วยปุ่ม "คืนให้ AI" ตามเดิม; best-effort ไม่บล็อกการส่ง
    // (?. — spec หลายตัว mock roomManager บางส่วน ไม่มีเมธอดนี้)
    void this.roomManager
      .pauseAiIfActive?.(params.roomId, params.staffId)
      ?.then((paused) => {
        if (paused) {
          this.gateway?.emitRoomUpdate(params.roomId, {
            roomId: params.roomId,
            aiPaused: true,
            aiPausedById: params.staffId,
          });
        }
      })
      ?.catch(() => undefined);

    // Idempotency: reuse the row for this clientMessageId if it already exists.
    let saved = params.clientMessageId
      ? await this.roomManager.findByClientMessageId(params.roomId, params.clientMessageId)
      : null;

    if (saved?.outboundSentAt) {
      // Already delivered on a prior attempt — do NOT re-send to the customer.
      return {
        success: true,
        message: {
          id: saved.id,
          clientMessageId: saved.clientMessageId,
          createdAt: saved.createdAt,
        },
      };
    }

    if (!saved) {
      try {
        saved = await this.roomManager.saveMessage({
          roomId: params.roomId,
          role: MessageRole.STAFF,
          type: params.type ?? MessageType.TEXT,
          text: params.text,
          mediaUrl: params.mediaUrl,
          mediaType: params.mediaType,
          staffId: params.staffId,
          clientMessageId: params.clientMessageId,
        });
      } catch (e: any) {
        if (e?.code === 'P2002' && params.clientMessageId) {
          // A concurrent identical send won the unique race. Let it own delivery —
          // do NOT call the adapter again (that would double-deliver to the customer).
          saved = await this.roomManager.findByClientMessageId(
            params.roomId,
            params.clientMessageId,
          );
          if (saved) {
            return {
              success: true,
              message: {
                id: saved.id,
                clientMessageId: saved.clientMessageId,
                createdAt: saved.createdAt,
              },
            };
          }
          throw e; // unreachable in practice — P2002 implies the row exists
        } else {
          throw e;
        }
      }
    }

    if (!saved) {
      return { success: false, error: 'save failed' };
    }

    const outboundType = params.type ?? MessageType.TEXT;
    const deliveryUrl = params.deliveryMediaUrl ?? params.mediaUrl;
    const isImageBubble = outboundType === MessageType.IMAGE && !!deliveryUrl;
    // LINE (line-shop.adapter.ts:69-75) และ FB (facebook.adapter.ts:73-77) เลือก
    // payload จาก imageUrl ก่อน text เสมอ — ถ้าส่ง text มาด้วยจะถูกทิ้งเงียบๆ
    // ผู้เรียกที่อยากได้ทั้งรูปและข้อความต้องส่ง 2 bubble (ดู ChatCommerceService)
    const result = await adapter.sendMessage({
      externalUserId,
      channel: room.channel,
      type: outboundType,
      text: isImageBubble ? undefined : params.text,
      // adapters read only `imageUrl` (grep: no adapter reads OutboundMessage.mediaUrl)
      ...(isImageBubble ? { imageUrl: deliveryUrl } : {}),
    });

    if (!result.success) {
      this.logger.error(`Failed to send staff message on ${room.channel}: ${result.error}`);
      return { success: false, error: result.error ?? 'send failed' };
    }

    // Delivered — stamp the idempotency flag so a retry won't re-send.
    // externalMessageId (if the adapter returns one, e.g. FB `mid`) is also
    // stamped here — see markOutboundSent jsdoc for why (FB echo dedup).
    await this.roomManager.markOutboundSent(saved.id, result.externalMessageId);
    return {
      success: true,
      message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt },
    };
  }

  /**
   * บันทึกโน้ตระบบลงห้อง (ไม่ส่งออกหาลูกค้า)
   *
   * ใช้กับเหตุการณ์ที่ทีมงานต้องเห็นในเธรดแต่ลูกค้าไม่ได้พิมพ์เอง เช่นลูกค้ากด
   * ลิงก์ Messenger จากหน้าสินค้าบนเว็บ (B4) — ข้อความมีชื่อรุ่นเต็มเพื่อให้
   * ProductContextCard/detection จับได้เหมือนลูกค้าพิมพ์ชื่อรุ่นมาเอง
   */
  async postSystemNote(roomId: string, text: string): Promise<void> {
    await this.roomManager.saveMessage({
      roomId,
      role: MessageRole.SYSTEM,
      type: MessageType.TEXT,
      text,
    });
    this.gateway?.emitNewMessage(roomId, {
      role: 'SYSTEM',
      text,
      type: MessageType.TEXT,
      roomId,
    });
  }

  /**
   * Send a pre-built OutboundMessage as the staff. Used by canned-response
   * sender for multi-bubble flows where bubble-type-specific fields (imageUrl,
   * sticker, location, flexJson, etc.) must reach the adapter unchanged.
   *
   * Returns the adapter's SendResult so the caller can surface droppedReason
   * (unsupported bubble on the channel) and per-bubble errors.
   */
  async sendStaffOutbound(
    roomId: string,
    message: Partial<OutboundMessage>,
    staffId: string,
  ): Promise<{
    success: boolean;
    error?: string;
    externalMessageId?: string;
    droppedReason?: string;
  }> {
    const room = await this.roomManager.findById(roomId);
    if (!room) {
      this.logger.error(`Room not found: ${roomId}`);
      return { success: false, error: 'Room not found' };
    }

    const adapter = this.adapterMap.get(room.channel);
    if (!adapter) {
      const error = `No adapter registered for channel ${room.channel}`;
      this.logger.error(error);
      return { success: false, error };
    }

    const externalUserId = room.externalUserId ?? room.lineUserId ?? '';

    // Persist to ChatMessage log so the staff inbox renders the outbound bubble.
    // Type is best-effort guessed from the dominant field.
    const type: MessageType = message.imageUrl
      ? MessageType.IMAGE
      : message.sticker
        ? MessageType.STICKER
        : message.videoUrl
          ? MessageType.VIDEO
          : message.location
            ? MessageType.LOCATION
            : message.flexJson || message.jsonPayload
              ? MessageType.TEMPLATE
              : MessageType.TEXT;

    await this.roomManager.saveMessage({
      roomId,
      role: MessageRole.STAFF,
      type,
      text: message.text,
      mediaUrl: message.imageUrl ?? message.videoUrl,
      staffId,
    });

    const result = await adapter.sendMessage({
      ...(message as any),
      externalUserId,
      channel: room.channel,
      type,
    });

    if (!result.success) {
      this.logger.error(`Failed to send staff outbound on ${room.channel}: ${result.error}`);
    }
    return result;
  }

  /** Get registered adapter for a channel */
  getAdapter(channel: ChatChannel): IChannelAdapter | undefined {
    return this.adapterMap.get(channel);
  }

  /** Find domain handler that supports the given channel */
  /**
   * ข้อความลูกค้าที่ไม่มีตัวอักษร (สติกเกอร์ FB มาเป็น attachment image เช่นกัน) —
   * แปลงเป็น marker ภาษาไทยให้บอทรู้ว่าลูกค้าส่งอะไรมา แทนการส่งสตริงว่างเข้า LLM
   */
  private static describeNonTextInbound(type: MessageType): string {
    switch (type) {
      case MessageType.IMAGE:
        return '[ลูกค้าส่งรูปภาพมา 1 รูป — อาจเป็นเอกสาร/สลิป/รูปเครื่อง/สติกเกอร์]';
      case MessageType.AUDIO:
        return '[ลูกค้าส่งข้อความเสียงมา — บอทฟังเสียงไม่ได้]';
      case MessageType.VIDEO:
        return '[ลูกค้าส่งวิดีโอมา]';
      case MessageType.FILE:
        return '[ลูกค้าส่งไฟล์แนบมา]';
      case MessageType.LOCATION:
        return '[ลูกค้าแชร์ตำแหน่งที่ตั้งมา]';
      default:
        return '[ลูกค้าส่งข้อความที่ไม่ใช่ตัวอักษร]';
    }
  }

  private findDomainHandler(channel: ChatChannel): IDomainHandler | undefined {
    return this.domainHandlers.find((h) => h.supportsChannel(channel));
  }
}
