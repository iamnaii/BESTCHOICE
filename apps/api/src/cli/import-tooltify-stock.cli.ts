// Stock writes stay disabled until the shared cutover runner can validate the frozen plan.
console.error(
  'Tooltify stock import requires a reviewed manifest for current-stock-snapshot. ' +
    'Inspect the snapshot with npm run import:tooltify-cutover --workspace=@installment/api -- ' +
    'inspect --out-dir <dir> <snapshot.xlsx>. Stock apply is currently disabled.',
);
process.exitCode = 1;
