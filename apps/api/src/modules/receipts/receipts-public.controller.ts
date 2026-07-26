import { Controller, Get, Param, Res, NotFoundException, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReceiptsService } from './receipts.service';

/**
 * Public (NO JwtAuthGuard/RolesGuard) PDF download for an auto-issued
 * ใบลดหนี้ (Credit Note) — the link a customer taps from LINE after a
 * repossession/write-off CN is issued (CreditNoteDocumentService).
 *
 * This is a SEPARATE controller class rather than a `@Public()` route bolted
 * onto ReceiptsController: that controller's class-level guards are
 * `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`, and BranchGuard reads
 * `request.user` unconditionally — it has no `@Public()` escape hatch, so it
 * would throw ForbiddenException('ไม่พบข้อมูลผู้ใช้') on an unauthenticated
 * request regardless of any per-route decorator. A separate controller with
 * no class-level guards is the only clean way to expose one truly public GET.
 *
 * Access control is entirely token-based:
 *   - `publicToken` is a 256-bit random value (crypto.randomBytes(32)) — only
 *     findable by whoever received the LINE link.
 *   - `publicTokenExpiresAt` — 30-day TTL from issuance.
 *   - `cnSource != null` — scopes lookup to CN receipts only (see
 *     ReceiptQueryService.findByPublicToken).
 *   - Both "token not found" and "token expired" return the SAME 404 message
 *     so the response never confirms whether a given token ever existed.
 *   - Throttled per-IP (10/min) to blunt brute-force/scraping attempts even
 *     though the token space makes guessing infeasible.
 *
 * See `.claude/rules/security.md` — `receipts-public` intentionally-public entry.
 */
@ApiTags('Receipts')
@Controller('receipts/public')
export class ReceiptsPublicController {
  private readonly logger = new Logger(ReceiptsPublicController.name);

  constructor(private receiptsService: ReceiptsService) {}

  @Get(':token/pdf')
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  async getPublicCreditNotePdf(@Param('token') token: string, @Res() res: Response) {
    const receipt = await this.receiptsService.findByPublicToken(token);

    // Same message whether the token is unknown, already soft-deleted, not a
    // CN, or simply expired — never log the raw token (only the resolved
    // receipt id, once resolved) so a leaked server log can't be replayed.
    if (!receipt || !receipt.publicTokenExpiresAt || receipt.publicTokenExpiresAt < new Date()) {
      throw new NotFoundException('ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว');
    }

    this.logger.log(`[receipts-public] serving CN PDF — receiptId=${receipt.id}`);

    const pdf = await this.receiptsService.generatePDF(receipt.id);
    const filename = `ใบลดหนี้-${receipt.receiptNumber}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  }
}
