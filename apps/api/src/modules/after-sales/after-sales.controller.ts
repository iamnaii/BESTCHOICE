import type { Readable } from 'node:stream';
import { currentDomainAccess, onDomainCommit } from '../employee-access/access-execution-context';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesDocumentService } from './services/after-sales-document.service';
import { IntakePhotosInterceptor } from './intake-photos.interceptor';
import { LookupDto } from './dto/lookup.dto';
import { CreateCaseDto } from './dto/create-case.dto';
import { ListCasesDto } from './dto/list-cases.dto';
import { CancelCaseDto } from './dto/cancel-case.dto';
import { SendDto } from '../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../repair-tickets/dto/return-to-customer.dto';
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';
import { ExchangePreviewDto } from './dto/exchange-preview.dto';
import { ReplacementProductsDto } from './dto/replacement-products.dto';
import { ExchangeConfirmDto } from './dto/exchange-confirm.dto';
import { ExchangeRejectDto } from './dto/exchange-reject.dto';
import { SwitchToRepairDto } from './dto/switch-to-repair.dto';
import { ApproveExchangeRequestDto } from './dto/exchange-approve.dto';
import { ExchangeDeliverDto } from './dto/exchange-deliver.dto';

const ALL = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] as const;
const STAFF = ['OWNER', 'BRANCH_MANAGER', 'SALES'] as const;
const MGR = ['OWNER', 'BRANCH_MANAGER'] as const;
const OWNER_ONLY = ['OWNER'] as const;

const sendImage = (res: Response, key: string, stream: NodeJS.ReadableStream | Buffer) => {
  const ext = key.split('.').pop();
  res.setHeader(
    'Content-Type',
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
  );
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (Buffer.isBuffer(stream)) res.send(stream);
  else stream.pipe(res);
};

/** Consume managed storage within the authorization lifetime. Only the bounded
 * in-memory result survives commit; no live external stream escapes a rollback. */
const imageBytes = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > EVIDENCE_IMAGE_MAX_BYTES)
      throw new ServiceUnavailableException('ไม่สามารถเปิดรูปได้');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

const sendPdf = (res: Response, pdf: Buffer, filename: string) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Length': pdf.length.toString(),
    'Cache-Control': 'private, no-store',
  });
  res.send(pdf);
};

@Controller('after-sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AfterSalesController {
  constructor(
    private readonly svc: AfterSalesService,
    private readonly docs: AfterSalesDocumentService,
  ) {}

  @Get('lookup')
  @Roles(...ALL)
  lookup(@Query() dto: LookupDto, @CurrentUser() user: any) {
    return this.svc.lookup(dto, user);
  }

  @Post()
  @Roles(...STAFF)
  // IntakePhotosInterceptor = FilesInterceptor('photos', 6, 5MB) + แปล error ของ Multer เป็นไทย
  @UseInterceptors(IntakePhotosInterceptor)
  create(
    @Body() dto: CreateCaseDto,
    @UploadedFiles() photos: Express.Multer.File[],
    @CurrentUser() user: any,
  ) {
    return this.svc.createCase(dto, photos ?? [], user);
  }

  @Get()
  @Roles(...ALL)
  list(@Query() dto: ListCasesDto, @CurrentUser() user: any) {
    return this.svc.list(dto, user);
  }

  @Get('by-ticket/:ticketId')
  @Roles(...ALL)
  byTicket(@Param('ticketId', ParseUUIDPipe) ticketId: string, @CurrentUser() user: any) {
    return this.svc.findByTicket(ticketId, user);
  }

  // ===== เปลี่ยนเครื่อง (PR 2) =====
  // GET แบบ single/two-segment ต้องอยู่ก่อน `@Get(':id')` เสมอ — Nest แมตช์ตามลำดับ
  // ประกาศ ไม่งั้น `replacement-products` จะถูก `:id` (+ ParseUUIDPipe) ชิงจับก่อน

  @Get('exchange/preview')
  @Roles(...STAFF)
  previewExchange(@Query() dto: ExchangePreviewDto, @CurrentUser() user: any) {
    return this.svc.preview(dto, user);
  }

  @Get('replacement-products')
  @Roles(...ALL)
  replacementProducts(@Query() dto: ReplacementProductsDto, @CurrentUser() user: any) {
    return this.svc.replacementProducts(dto, user);
  }

  @Post(':id/exchange/confirm')
  @Roles(...MGR)
  confirmExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeConfirmDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.confirmSameModel(id, dto, user);
  }

  @Post(':id/exchange/deliver')
  @Roles(...STAFF)
  deliverExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeDeliverDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.deliver(id, user, dto);
  }

  /** PR 5 — รายการบัญชีที่จะลงเมื่อยืนยันเปลี่ยนรุ่นเดิมขายสด (MGR — เห็นต้นทุน) */
  @Get(':id/exchange/cash-preview')
  @Roles(...MGR)
  cashExchangePreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('replacementProductId') replacementProductId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.svc.cashExchangePreview(id, replacementProductId || undefined, user);
  }

  @Post(':id/exchange/reject')
  @Roles(...MGR)
  rejectExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeRejectDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.rejectSameModel(id, dto, user);
  }

  @Post(':id/switch-to-repair')
  @Roles(...STAFF)
  switchToRepair(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SwitchToRepairDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.switchToRepair(id, dto, user);
  }

  @Post(':id/approve')
  @Roles(...MGR)
  approveExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveExchangeRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.approvePriced(id, dto, user);
  }

  @Post(':id/reject')
  @Roles(...OWNER_ONLY)
  rejectPricedExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeRejectDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.rejectPriced(id, dto, user);
  }

  @Post(':id/cancel-swap')
  @Roles(...MGR)
  cancelSwap(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeRejectDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.cancelSwap(id, dto, user);
  }

  // ===== จบส่วนเปลี่ยนเครื่อง (PR 2) =====

  @Get(':id')
  @Roles(...ALL)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.svc.getCase(id, user);
  }

  @Get(':id/photos/:index')
  @Roles(...ALL)
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { key, stream } = await this.svc.getPhoto(id, index, user);
    if (currentDomainAccess()) {
      const bytes = await imageBytes(stream);
      onDomainCommit(async () => {
        sendImage(res, key, bytes);
      });
    } else sendImage(res, key, stream);
  }

  @Get(':id/purchase-photos/:angle')
  @Roles(...ALL)
  async purchasePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('angle') angle: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { key, stream } = await this.svc.getPurchasePhoto(id, angle, user);
    if (currentDomainAccess()) {
      const bytes = await imageBytes(stream);
      onDomainCommit(async () => {
        sendImage(res, key, bytes);
      });
    } else sendImage(res, key, stream);
  }

  // PR 4 — ใบรับฝากเครื่อง / ใบส่งมอบ (สเปก 6: ทั้ง 5 role) · ขอบเขตสาขาอยู่ใน service
  @Get(':id/receipt.pdf')
  @Roles(...ALL)
  async receiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.render(id, 'RECEIPT', user);
    const send = async () => {
      sendPdf(res, pdf, `after-sales-receipt-${caseNumber}.pdf`);
    };
    if (currentDomainAccess()) onDomainCommit(send);
    else await send();
  }

  @Get(':id/handover.pdf')
  @Roles(...ALL)
  async handoverPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.render(id, 'HANDOVER', user);
    const send = async () => {
      sendPdf(res, pdf, `after-sales-handover-${caseNumber}.pdf`);
    };
    if (currentDomainAccess()) onDomainCommit(send);
    else await send();
  }

  /** PR 5 — ใบรับคืนเครื่อง (เคสขายสดที่ยืนยันแล้ว) */
  @Get(':id/return.pdf')
  @Roles(...ALL)
  async returnPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.render(id, 'RETURN', user);
    sendPdf(res, pdf, `after-sales-return-${caseNumber}.pdf`);
  }

  /** PR 5 — ใบรับคืน + ใบส่งมอบเครื่องทดแทน ใน PDF เดียว 2 หน้า */
  @Get(':id/exchange-docs.pdf')
  @Roles(...ALL)
  async exchangeDocsPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.renderCashExchangeDocs(id, user);
    sendPdf(res, pdf, `after-sales-exchange-docs-${caseNumber}.pdf`);
  }

  @Post(':id/photos')
  @Roles(...STAFF)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES } }))
  addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.svc.addPhoto(id, file, user);
  }

  @Post(':id/repair/send')
  @Roles(...STAFF)
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto, @CurrentUser() user: any) {
    return this.svc.send(id, dto, user);
  }

  @Post(':id/repair/mark-repaired')
  @Roles(...STAFF)
  markRepaired(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkRepairedDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.markRepaired(id, dto, user);
  }

  @Post(':id/repair/send-back')
  @Roles(...STAFF)
  sendBack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendBackDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.sendBack(id, dto, user);
  }

  @Post(':id/repair/return')
  @Roles(...STAFF)
  ret(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnToCustomerDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.returnToCustomer(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles(...MGR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCaseDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.cancelCase(id, dto, user);
  }
}
