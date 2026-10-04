export interface AuditJournalLine {
  accountCode: string;
  debit: string | number;
  credit: string | number;
}

export function AuditJournalTable({ lines }: { lines?: AuditJournalLine[] }) {
  return (
    <table className="w-full font-mono text-[11px]">
      <tbody>
        {lines?.map((l, i) => (
          <tr key={i} className="border-b border-border/30">
            <td className="py-1 pr-2">{l.accountCode}</td>
            <td className="text-right pr-2">
              {Number(l.debit).toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </td>
            <td className="text-right">
              {Number(l.credit).toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
