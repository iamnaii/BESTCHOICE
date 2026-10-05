import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { ChatLibraryFile, Prisma } from '@prisma/client';
import { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { getBranchScope } from '../../auth/branch-access.util';
import { detectFile } from '../../credit-check/services/media-fetch.util';
import { ChatWorkAccessService, roomWorkWhere } from './chat-work-access.service';
import { CreateLibraryFolderDto, LibraryQueryDto, UploadLibraryFileDto } from '../dto/chat-library.dto';

@Injectable()
export class ChatLibraryService {
  private readonly logger = new Logger(ChatLibraryService.name);
  constructor(private readonly db: PrismaService, private readonly access: ChatWorkAccessService, private readonly storage: StorageService) {}
  async context(authenticated: ChatWorkActor, scope: WorkScope, db: Prisma.TransactionClient = this.db) {
    const actor = await this.access.currentActor(authenticated, db);
    roomWorkWhere(actor, scope);
    const flag = await db.systemConfig.findFirst({ where: { key: 'chat_cloud_library_enabled', value: 'true', deletedAt: null } });
    if (!flag) throw new ForbiddenException('ยังไม่เปิดใช้งานคลังไฟล์');
    const branch = getBranchScope(actor);
    const branchId = branch.all ? scope.branchId : branch.branchId;
    return { actor, branchId: branchId ?? null, where: { company: scope.company, deletedAt: null, ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}) } };
  }
  private paging(query: Partial<LibraryQueryDto>) {
    return { page: Math.max(1, query.page ?? 1), limit: Math.min(100, Math.max(1, query.limit ?? 40)) };
  }
  async folders(actor: ChatWorkActor, query: WorkScope & Partial<LibraryQueryDto>) {
    const { where } = await this.context(actor, query);
    const { page, limit } = this.paging(query);
    const filter = { ...where, ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' as const } } : {}) };
    const [total, data] = await this.db.$transaction([
      this.db.chatLibraryFolder.count({ where: filter }),
      this.db.chatLibraryFolder.findMany({ where: filter, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page-1)*limit, take: limit, select: { id: true, name: true, branchId: true } }),
    ]);
    return { data, total, page, limit };
  }
  async createFolder(actor: ChatWorkActor, scope: WorkScope, input: CreateLibraryFolderDto) {
    const { branchId } = await this.context(actor, scope);
    const name = input.name.trim();
    if (!name || name.length > 80) throw new BadRequestException('ชื่อโฟลเดอร์ต้องมี 1–80 ตัวอักษร');
    if (branchId && !await this.db.branch.findFirst({ where: { id: branchId, deletedAt: null, isActive: true } })) throw new NotFoundException('ไม่พบสาขา');
    try {
      return await this.db.chatLibraryFolder.create({ data: { company: scope.company, branchId, creatorId: actor.id, name }, select: { id: true, name: true, branchId: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('มีโฟลเดอร์ชื่อนี้แล้ว');
      throw error;
    }
  }
  private present(file: ChatLibraryFile) {
    return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, company: file.company, branchId: file.branchId, folderId: file.folderId, createdAt: file.createdAt.toISOString() };
  }
  async resolve(actor: ChatWorkActor, scope: WorkScope, id: string, db: Prisma.TransactionClient = this.db) {
    const { where } = await this.context(actor, scope, db);
    const file = await db.chatLibraryFile.findFirst({ where: { AND: [where, { id }, { OR: [{ folderId: null }, { folder: { deletedAt: null } }] }] } });
    if (!file) throw new NotFoundException('ไม่พบไฟล์หรือไม่มีสิทธิ์เข้าถึง');
    return file;
  }
  async files(actor: ChatWorkActor, query: WorkScope & Partial<LibraryQueryDto>) {
    const { where } = await this.context(actor, query);
    if (query.folderId && !await this.db.chatLibraryFolder.findFirst({ where: { ...where, id: query.folderId } })) throw new NotFoundException('ไม่พบโฟลเดอร์');
    const filter: Prisma.ChatLibraryFileWhereInput = { AND: [where, { OR: [{ folderId: null }, { folder: { deletedAt: null } }] }],
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...(query.kind ? { mimeType: query.kind === 'pdf' ? 'application/pdf' : { startsWith: 'image/' } } : {}),
    };
    const { page, limit } = this.paging(query);
    const [total, data] = await this.db.$transaction([
      this.db.chatLibraryFile.count({ where: filter }),
      this.db.chatLibraryFile.findMany({ where: filter, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page-1)*limit, take: limit }),
    ]);
    return { data: data.map(file => this.present(file)), total, page, limit };
  }
  async content(actor: ChatWorkActor, scope: WorkScope, id: string) {
    const file = await this.resolve(actor, scope, id);
    return { file: this.present(file), stream: await this.storage.getStream(file.key) };
  }
  async upload(actor: ChatWorkActor, scope: WorkScope, input: UploadLibraryFileDto, file?: Express.Multer.File) {
    const context = await this.context(actor, scope);
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์');
    const type = detectFile(file.buffer, file.mimetype);
    if (!this.storage.configured) throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บไฟล์');
    // Control bytes and path separators must never survive in a display/download name.
    // eslint-disable-next-line no-control-regex
    const name = file.originalname.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 180) || `ไฟล์.${type.ext}`;
    let branchId = context.branchId;
    if (input.folderId) {
      const folder = await this.db.chatLibraryFolder.findFirst({ where: { ...context.where, id: input.folderId } });
      if (!folder) throw new NotFoundException('ไม่พบโฟลเดอร์');
      // Branch-limited staff may read company-wide folders but cannot publish company-wide assets.
      branchId = folder.branchId ?? context.branchId;
    }
    const requestKey = `${actor.id}:${scope.company}:${input.requestKey}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([name, input.folderId ?? null, branchId])).update(file.buffer).digest('hex');
    const key = `staff-chat/library/${scope.company}/${randomUUID()}.${type.ext}`;
    let retained = false;
    try {
      await this.storage.upload(key, file.buffer, type.mimeType);
      const saved = await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`;
        const fresh = await this.context(actor, scope, tx);
        if (input.folderId && !await tx.chatLibraryFolder.findFirst({ where: { ...fresh.where, id: input.folderId } })) throw new NotFoundException('ไม่พบโฟลเดอร์');
        if (branchId !== null && fresh.branchId !== null && branchId !== fresh.branchId) throw new ForbiddenException('สิทธิ์สาขาเปลี่ยน กรุณาเลือกไฟล์ใหม่');
        const duplicate = await tx.chatLibraryFile.findUnique({ where: { requestKey } });
        if (duplicate) {
          if (duplicate.fingerprint !== fingerprint || duplicate.deletedAt) throw new ConflictException('คำขออัปโหลดนี้ถูกใช้แล้ว กรุณาเลือกไฟล์ใหม่');
          await this.resolve(actor, scope, duplicate.id, tx);
          return { file: duplicate, created: false };
        }
        const result = await tx.chatLibraryFile.create({ data: { company: scope.company, branchId, creatorId: actor.id, folderId: input.folderId, key, name, mimeType: type.mimeType, size: file.buffer.length, requestKey, fingerprint } });
        return { file: result, created: true };
      });
      retained = saved.created;
      return this.present(saved.file);
    } finally {
      if (!retained) try { await this.storage.delete(key); } catch { this.logger.error(`Unreferenced library object requires cleanup: ${key}`); }
    }
  }
}
