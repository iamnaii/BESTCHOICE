-- Keep historical identifiers unknown; never infer a serial from IMEI or mutable stock data.
ALTER TABLE "trade_ins" ADD COLUMN "serial_number" TEXT;
