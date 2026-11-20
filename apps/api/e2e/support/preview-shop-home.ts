import { PrismaService } from '../../src/prisma/prisma.service';
import { ShopHomeController } from '../../src/modules/shop-home/shop-home.controller';
import { ShopHomeService } from '../../src/modules/shop-home/shop-home.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { AfterSalesQueryService } from '../../src/modules/after-sales/services/after-sales-query.service';
import { ShopCashCloseService } from '../../src/modules/shop-tenders/shop-cash-close.service';
import { ProductsStockService } from '../../src/modules/products/products-stock.service';
import { ReorderPointsService } from '../../src/modules/inventory/reorder-points.service';
import { GeneralLedgerReportService } from '../../src/modules/accounting/general-ledger-report.service';
import { CompanyResolverService } from '../../src/modules/journal/company-resolver.service';
import { previewBookings } from './preview-sales-fixture';

/** Real read services against the isolated preview DB. No write methods are exposed.
 * Facades are replaced by the same query collaborators they delegate to; dependencies
 * used only by cash-close/reorder mutations are intentionally unavailable here.
 */
export function previewShopHome(db: PrismaService) {
  const companies = new CompanyResolverService(db);
  return new ShopHomeController(new ShopHomeService(
    db,
    new SalesQueryService(db) as never,
    previewBookings(db),
    new AfterSalesQueryService(db) as never,
    new ShopCashCloseService(db, null as never, null as never, companies, null as never, null as never),
    new ProductsStockService(db),
    new ReorderPointsService(db, null as never),
    companies,
    new GeneralLedgerReportService(db, companies) as never,
  ));
}
