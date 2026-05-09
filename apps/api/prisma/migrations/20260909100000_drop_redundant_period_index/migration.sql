-- Drop redundant single-column [period] index — covered by [period, reversedAt] compound index
-- (PostgreSQL uses leftmost prefix on the compound for any WHERE period = ? query)
DROP INDEX IF EXISTS "depreciation_entries_period_idx";
