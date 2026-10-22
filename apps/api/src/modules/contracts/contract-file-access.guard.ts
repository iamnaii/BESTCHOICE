import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ContractDocumentsService } from './contract-documents.service';
import { AccessContractFilesBoundaries } from '../employee-access/access-contract-files-boundaries';
import { uploadedDocumentHandlers } from '../employee-access/access-contract-files-context';

const FILE_RESOURCE = 'contract-file-resource';

/** Resolve the owning contract before any staff read, signature or file side effect. */
@Injectable()
export class ContractFileAccessGuard implements CanActivate {
  constructor(
    private readonly documents: ContractDocumentsService,
    private readonly reflector: Reflector,
    @Optional() private readonly uploads?: AccessContractFilesBoundaries,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const operation = uploadedDocumentHandlers.get(context.getClass())?.get(context.getHandler());
    if (operation) {
      if (this.uploads) {
        const managed = await this.uploads.preflight(operation, req);
        this.uploads.attach(operation, req);
        if (managed) return true;
      } else throw new ForbiddenException('ต้องตรวจสิทธิ์เอกสารปัจจุบัน');
    }
    const generated =
      this.reflector.get<string>(FILE_RESOURCE, context.getHandler()) === 'generated';
    if (generated) await this.documents.assertGeneratedAccess(req.params.id, req.user);
    else
      await this.documents.assertContractAccess(
        req.params.contractId ?? req.params.id,
        req.user,
        req.params.docId,
      );
    return true;
  }
}

export const ContractFileAccess = (resource: 'contract' | 'generated' = 'contract') =>
  applyDecorators(SetMetadata(FILE_RESOURCE, resource), UseGuards(ContractFileAccessGuard));
