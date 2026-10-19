/** Keep the actual hit visible even when it occurs late in a long message. Text stays escaped by React. */
export default function SearchExcerpt({ text, search }: { text: string; search: string }) {
  const query = search.trim();
  const index = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  const start = Math.max(0, index - 28);
  const end = Math.min(text.length, index + query.length + 65);
  return <>
    {start > 0 && '…'}{text.slice(start, index)}
    <mark className="rounded bg-primary/15 text-foreground font-semibold">{text.slice(index, index + query.length)}</mark>
    {text.slice(index + query.length, end)}{end < text.length && '…'}
  </>;
}
