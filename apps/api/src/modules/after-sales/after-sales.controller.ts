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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AfterSalesService } from './after-sales.service';
import { LookupDto } from './dto/lookup.dto';
import { CreateCaseDto } from './dto/create-case.dto';
import { ListCasesDto } from './dto/list-cases.dto';
import { CancelCaseDto } from './dto/cancel-case.dto';
import { SendDto } from '../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../repair-tickets/dto/return-to-customer.dto';
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';

const ALL = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] as const;
const STAFF = ['OWNER', 'BRANCH_MANAGER', 'SALES'] as const;
const MGR = ['OWNER', 'BRANCH_MANAGER'] as const;

const sendImage = (res: Response, key: string, stream: NodeJS.ReadableStream) => {
  const ext = key.split('.').pop();
  res.setHeader(
    'Content-Type',
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
  );
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  stream.pipe(res);
};

@Controller('after-sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AfterSalesController {
  constructor(private readonly svc: AfterSalesService) {}

  @Get('lookup')
  @Roles(...ALL)
  lookup(@Query() dto: LookupDto, @CurrentUser() user: any) {
    return this.svc.lookup(dto, user);
  }

  @Post()
  @Roles(...STAFF)
  @UseInterceptors(
    FilesInterceptor('photos', 6, { limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES } }),
  )
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
    sendImage(res, key, stream);
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
    sendImage(res, key, stream);
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
