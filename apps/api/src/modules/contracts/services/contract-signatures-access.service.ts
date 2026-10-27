import { BadRequestException, Injectable } from '@nestjs/common';
import {
  canAccess,
  ContractSignatureAcknowledgement,
  ContractSignatureList,
  ContractSignatureType,
} from '@installment/shared';
import {
  AccessSignaturesBoundaries,
  signatureDenied,
} from '../../employee-access/access-signatures-boundaries';
import {
  GeneratedRequest,
  generatedSensitive,
} from '../../employee-access/access-generated-documents-context';
import { AccessResourceService } from '../../employee-access/access-resource.service';
import { AccessPartySourceService } from '../../employee-access/access-party-source.service';
import { PartyQueryPlan } from '../../employee-access/access-party-query-plan';
import { lockContractStaffSources } from '../../employee-access/access-contract-staff-source';
import { onDomainCommit } from '../../employee-access/access-execution-context';
import { DocumentsService } from '../documents.service';
import { SignContractDto } from '../dto/document.dto';
import { GeneratedDocumentsService } from './generated-documents.service';
import {
  normalizeSignature,
  normalizedSigner,
  signatureEvidenceRevision,
} from './signature-capture';
import { verifiedSignatureIdentities } from './signature-identity';
import { contractSignatureRequirements } from '../../../utils/validation.util';
import { safeEmbeddedImage } from './generated-document-effects';
@Injectable()
export class ContractSignaturesAccessService {
  constructor(
    private readonly access: AccessSignaturesBoundaries,
    private readonly canonical: DocumentsService,
    private readonly generated: GeneratedDocumentsService,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
  ) {}
  async capture(
    req: GeneratedRequest,
    dto: SignContractDto,
  ): Promise<ContractSignatureAcknowledgement> {
    const image = await normalizeSignature(dto);
    const choice = {
      ...(dto.templateSource ? { templateSource: dto.templateSource } : {}),
      ...(dto.templateId ? { templateId: dto.templateId } : {}),
    };
    if (
      (dto.templateSource !== undefined && dto.templateSource !== 'BUILTIN') ||
      (dto.templateId !== undefined &&
        (typeof dto.templateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(dto.templateId))) ||
      (dto.templateId && dto.templateSource)
    )
      throw new BadRequestException('ตัวเลือกแม่แบบไม่ถูกต้อง');
    return this.access.current('signContract', req, async (proof) => {
      if (
        (await proof.tx.signature.count({
          where: { contractId: proof.parent.id, deletedAt: null },
        })) >= 20
      )
        throw new BadRequestException('ลายเซ็นมากเกินขอบเขต');
      // An explicit missing template is a bad source request, before capture.
      if (
        choice.templateId &&
        !(await proof.tx.contractTemplate.count({
          where: { id: choice.templateId, deletedAt: null, isActive: true },
        }))
      )
        throw new BadRequestException('ไม่พบแม่แบบ');
      if (choice.templateId) {
        await proof.tx
          .$queryRaw`SELECT id FROM contract_templates WHERE id=${choice.templateId} FOR SHARE`;
        const [template] = await proof.tx.$queryRaw<
          Array<{ bytes: number }>
        >`SELECT octet_length(content_html)+COALESCE(octet_length(settings::text),0) AS bytes FROM contract_templates WHERE id=${choice.templateId} AND deleted_at IS NULL AND is_active=true`;
        if (!template || template.bytes > 2 * 1024 * 1024)
          throw new BadRequestException('แม่แบบไม่ถูกต้องหรือใหญ่เกินไป');
      }
      const row = await this.canonical.signContract(
        proof.parent.id,
        image.dataUrl,
        dto.signerType,
        {
          ip: String((req as GeneratedRequest & { ip?: string }).ip ?? '').slice(0, 64),
          userAgent:
            typeof req.headers['user-agent'] === 'string'
              ? req.headers['user-agent'].slice(0, 512)
              : undefined,
        },
        {
          signerName: dto.signerName,
          screenSize: dto.screenSize,
          gpsLatitude: dto.gpsLatitude,
          gpsLongitude: dto.gpsLongitude,
          staffUserId: proof.actorId,
        },
      );
      await proof.tx.signatureCaptureIdentity.create({
        data: {
          signatureId: row.id,
          contractId: proof.parent.id,
          customerId: proof.parent.customerId,
          branchId: proof.parent.branchId,
          productIds: [
            ...new Set([proof.parent.productId, ...proof.parent.bundleProductIds]),
          ].sort(),
          capturedById: proof.actorId,
          originalDataUrl: image.original,
          submittedHash: image.submittedHash,
          submittedSize: image.submittedSize,
          canonicalHash: image.canonicalHash,
          canonicalSize: image.canonicalSize,
          contractHash: row.contractHash!,
          evidenceRevision: signatureEvidenceRevision(row),
        },
      });
      const acknowledgement: ContractSignatureAcknowledgement = {
        id: row.id,
        signerType: normalizedSigner(row.signerType) as ContractSignatureType,
        signedAt: row.signedAt.toISOString(),
        status: 'CAPTURED',
        production: 'NOT_COMPLETE',
      };
      const contract = await proof.tx.contract.findUniqueOrThrow({
        where: { id: proof.parent.id },
        include: {
          customer: { select: { birthDate: true } },
          signatures: { where: { deletedAt: null }, select: { signerType: true, deletedAt: true } },
        },
      });
      if (contractSignatureRequirements(contract).complete) {
        const eventId = await this.generated.mintSignatureEvent(proof, choice);
        acknowledgement.production = eventId ? 'PENDING' : 'UNAVAILABLE';
        if (eventId)
          onDomainCommit(async () => {
            try {
              acknowledgement.production = await this.generated.consumeSignatureEvent(eventId);
            } catch {
              acknowledgement.production = 'FAILED';
            }
          });
      }
      await this.access.evidence(proof, 'SIGNATURE_CAPTURED');
      return acknowledgement;
    });
  }
  async remove(req: GeneratedRequest) {
    return this.access.current('deleteSignature', req, async (proof) => {
      await this.canonical.deleteSignature(proof.parent.id, String(req.params.signerType));
      await this.access.evidence(proof, 'SIGNATURE_DELETED');
      return {
        status: 'DELETED' as const,
        signerType: normalizedSigner(String(req.params.signerType)) as ContractSignatureType,
      };
    });
  }
  async list(req: GeneratedRequest): Promise<ContractSignatureList> {
    return this.access.current('getSignatures', req, async (proof) => {
      const page = Number(req.query.page ?? 1),
        limit = Number(req.query.limit ?? 50);
      const unavailable = (availability: 'UNAVAILABLE' | 'UNVERIFIED'): ContractSignatureList => ({
        availability,
        data: null,
        total: null,
        page,
        limit,
      });
      if (!proof.visible) return unavailable('UNAVAILABLE');
      const evidence = req.query.view === 'EVIDENCE';
      if (evidence && !proof.privateVisible) return unavailable('UNAVAILABLE');
      // Presence does not materialize private raster/original/SVG/device payloads.
      if (!evidence) {
        const rows = await proof.tx.signature.findMany({
          where: { contractId: proof.parent.id, deletedAt: null },
          orderBy: [{ signedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            signerType: true,
            signedAt: true,
            captureIdentity: { select: { contractId: true, customerId: true, branchId: true } },
          },
          take: 21,
        });
        if (rows.length > 20) throw new BadRequestException('ลายเซ็นมากเกินขอบเขต');
        if (
          rows.some(
            (row) =>
              row.captureIdentity &&
              (row.captureIdentity.contractId !== proof.parent.id ||
                row.captureIdentity.customerId !== proof.parent.customerId ||
                row.captureIdentity.branchId !== proof.parent.branchId),
          )
        )
          throw signatureDenied();
        await this.access.evidence(proof, 'SIGNATURE_PRESENCE_READ');
        return {
          availability: 'AVAILABLE',
          page,
          limit,
          total: rows.length,
          data: rows.slice((page - 1) * limit, page * limit).map((row) => ({
            id: row.id,
            signerType: normalizedSigner(row.signerType) as ContractSignatureType,
            signedAt: row.signedAt.toISOString(),
            evidenceStatus: row.captureIdentity ? 'CAPTURED' : 'UNVERIFIED',
          })),
        };
      }
      // Reject old unbounded evidence before materializing it. Never fetch retained SVG.
      const [size] = await proof.tx.$queryRaw<
        Array<{ invalid: bigint }>
      >`SELECT count(*)::bigint AS invalid FROM signatures WHERE contract_id=${proof.parent.id} AND deleted_at IS NULL AND (octet_length(signature_image)>500000 OR octet_length(COALESCE(signer_name,''))>800)`;
      if (size.invalid > 0n) return unavailable('UNVERIFIED');
      // Bound and authorize all contributing rows before count/page/completeness.
      const rows = await proof.tx.signature.findMany({
        where: { contractId: proof.parent.id, deletedAt: null },
        orderBy: [{ signedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          contractId: true,
          deletedAt: true,
          signerType: true,
          signatureImage: true,
          signerName: true,
          staffUserId: true,
          contractHash: true,
          signedAt: true,
        },
        take: 21,
      });
      if (rows.length > 20) throw new BadRequestException('ลายเซ็นมากเกินขอบเขต');
      const identities = await verifiedSignatureIdentities(proof.tx, proof.parent, rows);
      if (evidence && proof.managed && !identities) return unavailable('UNVERIFIED');
      if (evidence && identities) {
        for (const identity of identities) {
          for (const id of identity.productIds) {
            const source = await this.resources.product(proof.tx, id, true);
            if (
              proof.managed &&
              (!canAccess(proof.snapshot, 'products.read', source) ||
                generatedSensitive.some((k) => !canAccess(proof.snapshot, k, source)))
            )
              return unavailable('UNAVAILABLE');
          }
          const staff = await proof.tx.user.findUnique({
            where: { id: identity.capturedById },
            select: { deletedAt: true, isSystemUser: true },
          });
          if (!staff || staff.deletedAt || staff.isSystemUser) throw signatureDenied();
          if (proof.managed) {
            const plan = await PartyQueryPlan.create(proof.tx, this.parties);
            const where = await lockContractStaffSources(plan, [identity.capturedById]);
            if (!(await proof.tx.user.count({ where }))) return unavailable('UNAVAILABLE');
          }
        }
      }
      if (
        evidence &&
        rows.some(
          (row) =>
            !safeEmbeddedImage(row.signatureImage) ||
            row.signatureImage.length > 500000 ||
            (row.signerName?.length ?? 0) > 200,
        )
      )
        return unavailable('UNVERIFIED');
      const data = rows.slice((page - 1) * limit, page * limit).map((row) => ({
        id: row.id,
        signerType: normalizedSigner(row.signerType) as ContractSignatureType,
        signedAt: row.signedAt.toISOString(),
        evidenceStatus: identities ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
        ...(evidence ? { signatureImage: row.signatureImage, signerName: row.signerName } : {}),
      }));
      await this.access.evidence(
        proof,
        evidence ? 'SIGNATURE_EVIDENCE_READ' : 'SIGNATURE_PRESENCE_READ',
      );
      return { availability: 'AVAILABLE', data, total: rows.length, page, limit };
    });
  }
}
