import { retryable as retryableAccessExecution } from './access-resource.service';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { currentDomainAccess } from './access-execution-context';

/** Shared by managed and legacy writers; the managed executor owns its attempt. */
export async function writeSharedReference<T>(
  base: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shared-sticker-pricing-config'))`;
    return work(tx);
  };
  const current = currentDomainAccess();
  if (current) return run(current.client);
  for (let attempt = 1; ; attempt++) {
    try {
      return await base.$transaction(run, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt < 3 && retryableAccessExecution(error, false)) continue;
      throw safeReferenceError(error);
    }
  }
}
export function safeReferenceError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException('ข้อมูลอ้างอิงซ้ำกัน');
    return new InternalServerErrorException('บันทึกข้อมูลอ้างอิงไม่สำเร็จ');
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError
  )
    return new InternalServerErrorException('บันทึกข้อมูลอ้างอิงไม่สำเร็จ');
  return error;
}
