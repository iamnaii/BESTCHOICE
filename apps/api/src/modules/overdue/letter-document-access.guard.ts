import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

/** Resolve the letter's actual contract before reading or marking its PDF. */
@Injectable()
export class LetterDocumentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const actor = request.user;
    if (!actor?.role) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: request.params.id, deletedAt: null, contract: { deletedAt: null } },
      select: { contract: { select: { branchId: true } } },
    });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== letter.contract.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารของสาขานี้');
    }
    return true;
  }
}
