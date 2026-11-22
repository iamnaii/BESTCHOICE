import { Prisma } from '@prisma/client';
import type { PartyOrigin } from '@installment/shared';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ContactResolverService } from '../contacts/contact-resolver.service';
export type SupplierCreationContext = {
  resolver: Pick<ContactResolverService, 'findOrCreateByNaturalKey'>;
  accessCompanyCode?: string;
  accessBranchId?: string;
  contactOrigin?: PartyOrigin;
};
export async function createSupplierInTransaction(
  tx: Prisma.TransactionClient,
  dto: CreateSupplierDto,
  context: SupplierCreationContext,
) {
  const { paymentMethods, ...supplierData } = dto;
  let contactCreated = true;
  const contact = await context.resolver.findOrCreateByNaturalKey(tx, {
    name: dto.name,
    taxId: dto.taxId ?? null,
    nationalIdHash: null,
    phone: dto.phone ?? null,
    role: 'SUPPLIER',
    ...(context.contactOrigin ? { origin: context.contactOrigin } : {}),
    onExisting: () => {
      contactCreated = false;
    },
  });
  const supplier = await tx.supplier.create({
    data: {
      ...supplierData,
      ...(context.accessCompanyCode ? { accessCompanyCode: context.accessCompanyCode } : {}),
      ...(context.accessBranchId ? { accessBranchId: context.accessBranchId } : {}),
      contactId: contact.id,
      paymentMethods: paymentMethods?.length
        ? {
            create: paymentMethods.map((pm, index) => ({
              paymentMethod: pm.paymentMethod,
              bankName: pm.bankName,
              bankAccountName: pm.bankAccountName,
              bankAccountNumber: pm.bankAccountNumber,
              creditTermDays: pm.creditTermDays,
              isDefault: pm.isDefault ?? index === 0,
            })),
          }
        : undefined,
    },
    include: { paymentMethods: true },
  });
  return { supplier, contactCreated };
}
