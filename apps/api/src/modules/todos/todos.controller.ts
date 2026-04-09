import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ForbiddenException,
} from '@nestjs/common';
import { Res } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { TodosService } from './todos.service';
import { StorageService } from '../storage/storage.service';
import { CreateTodoDto, UpdateTodoDto, TodosQueryDto } from './dto/todo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthUser {
  id: string;
  role: string;
}

@ApiTags('Todos')
@ApiBearerAuth('JWT')
@Controller('todos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class TodosController {
  constructor(
    private todosService: TodosService,
    private storage: StorageService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: TodosQueryDto) {
    return this.todosService.findAll({
      view: query.view,
      search: query.search,
      status: query.status,
      priority: query.priority,
      assigneeId: query.assigneeId,
      branchId: query.branchId,
      page: query.page,
      limit: query.limit,
      currentUserId: user.id,
    });
  }

  @Post('upload-attachment')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: 10 * 1024 * 1024,
            message: 'ไฟล์มีขนาดเกิน 10MB',
          }),
          new FileTypeValidator({
            fileType: /^(image\/(jpeg|png|gif|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|video\/(mp4|quicktime))$/,
          }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    const safeName = file.originalname.replace(/[^\w.-]/g, '_');
    const key = `todos/${Date.now()}-${randomUUID()}-${safeName}`;
    await this.storage.upload(key, file.buffer, file.mimetype);

    return {
      url: `/api/todos/attachments/${encodeURIComponent(key)}`,
      key,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date().toISOString(),
    };
  }

  @Get('attachments/*')
  async downloadAttachment(@Param() params: Record<string, string>, @Res() res: Response) {
    const key = decodeURIComponent(params['0']);
    if (!key.startsWith('todos/')) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
    }
    const filename = key.split('/').pop() ?? 'file';
    // Infer content type from extension so the browser can render
    // images/PDFs inline. Without this everything was sent as
    // octet-stream + attachment, forcing a download dialog for every
    // preview click.
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
      pdf: 'application/pdf',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const isInlineable = contentType.startsWith('image/') || contentType === 'application/pdf';
    const disposition = isInlineable ? 'inline' : 'attachment';

    const stream = await this.storage.getStream(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
    stream.pipe(res);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.todosService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTodoDto, @CurrentUser() user: AuthUser) {
    return this.todosService.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTodoDto) {
    return this.todosService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggleDone(@Param('id') id: string) {
    return this.todosService.toggleDone(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.todosService.remove(id, user.id, user.role);
  }
}
