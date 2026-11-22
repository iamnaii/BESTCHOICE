# Tooltify extended stock totals

The user authorized the real Tooltify-to-BESTCHOICE migration on 22 November 2026. The newly exported stock report contains both `ต้นทุนสินค้า` and `รวมต้นทุน`. The latter is the group total; the former can be the displayed cost of one unit even when other units in the group have different costs. Multiplying the displayed cost by quantity is incorrect for such a group.

Use the explicitly labelled `รวมต้นทุน` column when it exists exactly once. Validate its monetary format and sum it using Decimal. A duplicate, blank or malformed explicit total must fail closed; do not fall back to the displayed unit cost. Reports without this column retain the existing evidence-bound `summaryCostBasis` behavior. Counts, row source references, hashes, source details and reconciliation rules remain intact.

The live export has 87 summary groups, 668 detail rows/units and 849282.00 total cost. One group has two units with displayed cost 13800 but total 26300. The original workbook stays in the private migration directory and must never enter Git or tests. Synthetic fixtures must reproduce these column semantics.

## Constraints

- Preserve original source workbooks and all existing source verification gates.
- No production writes, deployments or credential access from implementation workers.
- Use Decimal for money; no rounding away an unexplained difference.
- Keep old reports without an explicit extended-total column supported through their existing evidence-bound choice.
- Use isolated PostgreSQL harnesses for database-backed tests.
