-- Make PaymentLink.contract_id nullable (online orders have no contract)
ALTER TABLE "payment_links" ALTER COLUMN "contract_id" DROP NOT NULL;

-- Add unique constraint on OnlineOrder.payment_link_id (1:1 relation back to PaymentLink)
CREATE UNIQUE INDEX "online_orders_payment_link_id_key" ON "online_orders"("payment_link_id");

-- Add FK from OnlineOrder.payment_link_id -> PaymentLink.id
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
