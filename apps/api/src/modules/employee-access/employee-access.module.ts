import { AccessGeneratedDocumentsBoundaries } from './access-generated-documents-boundaries';
import { AccessContractFilesBoundaries } from './access-contract-files-boundaries';
import { AccessDocumentTemplateBoundaries } from './access-document-template-boundaries';
import { AccessContractJournalBoundary } from './access-contract-journal-boundary';
import { AccessContractDerivedBoundaries } from './access-contract-derived-boundaries';
import { AccessContractCancellationBoundaries } from './access-contract-cancellation-boundaries';
import { AccessShopSettlementBoundary } from './access-shop-settlement-boundary';
import { AccessPayoffEvidenceBoundary } from './access-payoff-evidence-boundary';
import { AccessPayoffRequestBoundary } from './access-payoff-request-boundary';
import { AccessContractPaymentReadBoundaries } from './access-contract-payment-read-boundaries';
import { AccessDirectExchangeBoundaries } from './access-direct-exchange-boundaries';
import { AccessContractConsentAuthority } from './access-contract-consent-authority';
import { AccessContractActivationBoundary } from './access-contract-activation-boundary';
import { AccessContractReviewBoundaries } from './access-contract-review-boundaries';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { AccessInterestReferenceBoundaries } from './access-interest-reference-boundaries';
import { AccessContractReadBoundaries } from './access-contract-read-boundaries';
import { AccessDefectBoundaries } from './access-defect-boundaries';
import { AccessLoyaltyBoundaries } from './access-loyalty-boundaries';
import { AccessPromotionsBoundaries } from './access-promotions-boundaries';
import { AccessStickerPricingBoundaries } from './access-sticker-pricing-boundaries';
import { AccessTenderMoneyBoundaries } from './access-tender-money-boundaries';
import { AccessTenderBoundaries } from './access-tender-boundaries';
import { AccessPartyBoundaries } from './access-party-boundaries';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessAfterSalesStreams } from './access-after-sales-streams';
import { AccessAfterSalesStreamBoundaries } from './access-after-sales-stream-boundaries';
import { AccessAfterSalesExchangeActionService } from './access-after-sales-exchange-action';
import { AccessAfterSalesActionBoundaries } from './access-after-sales-action-boundaries';
import { AccessAfterSalesBoundaries } from './access-after-sales-boundaries';
import { AccessAfterSalesSourceService } from './access-after-sales-source.service';
import { AccessAfterSalesProjectionService } from './access-after-sales-projection.service';
import { AccessAfterSalesQueryService } from './access-after-sales-query.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AccessRepairBoundaries } from './access-repair-boundaries';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { AccessSalesBoundaries } from './access-sales-boundaries';
import { AccessSalesProjectionService } from './access-sales-projection.service';
import { AccessTradeInBoundaries } from './access-trade-in-boundaries';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessAdjustmentsBoundaries } from './access-adjustments-boundaries';
import { AccessInventoryBoundaries } from './access-inventory-boundaries';
import { AccessProcurementBoundaries } from './access-procurement-boundaries';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessProcurementProjectionService } from './access-procurement-projection.service';
import { AccessResourceService } from './access-resource.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { AccessShopBoundaries } from './access-shop-boundaries';
import { AccessSocketBoundary } from './access-socket-boundary';
import { AccessPolicyService } from './access-policy';
import { Global, Module } from '@nestjs/common';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessService } from './employee-access.service';
import { AccessSnapshotService } from './access-snapshot.service';

// No AuthModule import: JWT strategy can consume snapshots without a module cycle.
@Global()
@Module({
  controllers: [EmployeeAccessController],
  providers: [AccessGeneratedDocumentsBoundaries, AccessContractFilesBoundaries, AccessDocumentTemplateBoundaries, AccessContractJournalBoundary, AccessContractDerivedBoundaries, AccessContractCancellationBoundaries, AccessShopSettlementBoundary, AccessPayoffEvidenceBoundary, AccessPayoffRequestBoundary, AccessContractPaymentReadBoundaries, AccessDirectExchangeBoundaries, AccessContractConsentAuthority, AccessContractActivationBoundary, AccessContractReviewBoundaries, AccessContractPreparationActions, AccessInterestReferenceBoundaries, AccessContractReadBoundaries, AccessDefectBoundaries, AccessLoyaltyBoundaries, AccessPromotionsBoundaries, AccessStickerPricingBoundaries, AccessTenderMoneyBoundaries, AccessTenderBoundaries, AccessPartyBoundaries, AccessPartySourceService, AccessAfterSalesStreams, AccessAfterSalesStreamBoundaries, AccessAfterSalesExchangeActionService, AccessAfterSalesActionBoundaries, AccessAfterSalesBoundaries, AccessAfterSalesSourceService, AccessAfterSalesProjectionService, AccessAfterSalesQueryService, AccessExchangeSourceService, AccessRepairBoundaries, AccessRepairSourceService, AccessRepairProjectionService, AccessSalesBoundaries, AccessSalesProjectionService, AccessTradeInBoundaries, AccessTradeInProjectionService, AccessAdjustmentsBoundaries, AccessInventoryBoundaries, AccessProcurementBoundaries, AccessProcurementSourceService, AccessProcurementProjectionService, AccessResourceService, AccessSensitiveService, AccessShopBoundaries, EmployeeAccessService, AccessSnapshotService, AccessPolicyService, AccessSocketBoundary],
  exports: [AccessGeneratedDocumentsBoundaries, AccessContractFilesBoundaries, AccessDocumentTemplateBoundaries, AccessContractConsentAuthority, AccessContractPreparationActions, AccessPartySourceService, AccessAfterSalesStreams, AccessAfterSalesExchangeActionService, AccessAfterSalesSourceService, AccessAfterSalesProjectionService, AccessAfterSalesQueryService, AccessExchangeSourceService, AccessRepairSourceService, AccessRepairProjectionService, AccessProcurementSourceService, AccessProcurementProjectionService, AccessResourceService, AccessSensitiveService, EmployeeAccessService, AccessSnapshotService, AccessPolicyService, AccessSocketBoundary],
})
export class EmployeeAccessModule {}
