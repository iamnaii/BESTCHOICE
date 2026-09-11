import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ContractDocumentsService } from './contract-documents.service';

const FILE_RESOURCE = 'contract-file-resource';

/** Resolve the owning contract before any staff read, signature or file side effect. */
@Injectable()
export class ContractFileAccessGuard implements CanActivate {
  constructor(private readonly documents: ContractDocumentsService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const generated = this.reflector.get<string>(FILE_RESOURCE, context.getHandler()) === 'generated';
    if (generated) await this.documents.assertGeneratedAccess(req.params.id, req.user);
    else await this.documents.assertContractAccess(req.params.contractId ?? req.params.id, req.user, req.params.docId);
    return true;
  }
}

export const ContractFileAccess = (resource: 'contract' | 'generated' = 'contract') =>
  applyDecorators(SetMetadata(FILE_RESOURCE, resource), UseGuards(ContractFileAccessGuard));
