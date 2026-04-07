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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { TodosService } from './todos.service';
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
  constructor(private todosService: TodosService) {}

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

  @Post('upload-attachment')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: 10 * 1024 * 1024,
            message: 'ไฟล์มีขนาดเกิน 10MB',
          }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'todos');
    fs.mkdirSync(uploadDir, { recursive: true });

    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${safeName}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    return {
      url: `/uploads/todos/${filename}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date().toISOString(),
    };
  }
}
