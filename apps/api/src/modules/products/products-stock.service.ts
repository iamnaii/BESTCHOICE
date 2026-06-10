import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferProductDto, BulkTransferDto } from './dto/transfer-product.dto';
import { StockTransferService } from './services/stock-transfer.service';
import { StockOverviewService } from './services/stock-overview.service';
import { StockReservationService } from './services/stock-reservation.service';

@Injectable()
export class ProductsStockService {
  private readonly transfer_: StockTransferService;
  private readonly overview: StockOverviewService;
  private readonly reservation: StockReservationService;

  constructor(private prisma: PrismaService) {
    this.transfer_ = new StockTransferService(prisma);
    this.overview = new StockOverviewService(prisma);
    this.reservation = new StockReservationService(prisma);
  }

  // === Stock Transfer ===

  transfer(productId: string, dto: TransferProductDto, userId: string) {
    return this.transfer_.transfer(productId, dto, userId);
  }

  bulkTransfer(dto: BulkTransferDto, userId: string) {
    return this.transfer_.bulkTransfer(dto, userId);
  }

  getPendingTransfers(branchId?: string) {
    return this.transfer_.getPendingTransfers(branchId);
  }

  getTransferHistory(filters: {
    branchId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    return this.transfer_.getTransferHistory(filters);
  }

  getTransferById(transferId: string, user?: { role: string; branchId: string | null }) {
    return this.transfer_.getTransferById(transferId, user);
  }

  dispatchTransfer(transferId: string, userId: string, trackingNote?: string) {
    return this.transfer_.dispatchTransfer(transferId, userId, trackingNote);
  }

  confirmTransfer(transferId: string, userId: string) {
    return this.transfer_.confirmTransfer(transferId, userId);
  }

  rejectTransfer(transferId: string, userId: string, reason?: string) {
    return this.transfer_.rejectTransfer(transferId, userId, reason);
  }

  getInTransitTransfers(branchId?: string) {
    return this.transfer_.getInTransitTransfers(branchId);
  }

  // === Stock Overview ===

  getStock(filters: {
    search?: string;
    branchId?: string;
    status?: string;
    category?: string;
    brand?: string;
    page?: number;
    limit?: number;
  }) {
    return this.overview.getStock(filters);
  }

  getStockDashboard(branchId?: string) {
    return this.overview.getStockDashboard(branchId);
  }

  getWarrantyExpiring(daysAhead: number = 30, branchId?: string) {
    return this.overview.getWarrantyExpiring(daysAhead, branchId);
  }

  getSupplierPerformance() {
    return this.overview.getSupplierPerformance();
  }

  // === Stock Reservation ===

  reserve(productId: string, _reason?: string) {
    return this.reservation.reserve(productId, _reason);
  }

  unreserve(productId: string) {
    return this.reservation.unreserve(productId);
  }
}
