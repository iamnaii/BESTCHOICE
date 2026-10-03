import { buildFlexJson, type FlexContent } from '@/lib/line-flex';

interface FlexPreviewCardProps {
  content: FlexContent;
}

export function FlexPreviewCard({ content }: FlexPreviewCardProps) {
  let jsonObj: Record<string, unknown> | null = null;
  try {
    if (content.flexMode === 'json') {
      jsonObj = JSON.parse(content.jsonText);
    } else {
      jsonObj = buildFlexJson(content) as Record<string, unknown>;
    }
  } catch {
    // invalid JSON
  }

  if (!jsonObj) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">
        JSON ไม่ถูกต้อง
      </div>
    );
  }

  const body = jsonObj.body as Record<string, unknown> | undefined;
  const contents = body?.contents as Array<Record<string, unknown>> | undefined;
  const titleItem = contents?.find((c) => c.weight === 'bold');
  const bodyItems = contents?.filter((c) => c.weight !== 'bold') ?? [];
  const hero = jsonObj.hero as Record<string, unknown> | undefined;
  const footer = jsonObj.footer as Record<string, unknown> | undefined;
  const footerContents = footer?.contents as Array<Record<string, unknown>> | undefined;
  const footerBtn = footerContents?.[0];
  const action = footerBtn?.action as Record<string, unknown> | undefined;

  const heroUrl = typeof hero?.url === 'string' ? hero.url : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md text-xs max-w-[200px]">
      {heroUrl && (
        <img
          src={heroUrl}
          alt="flex hero"
          className="h-24 w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="p-3 space-y-1">
        {titleItem && (
          <p className="font-bold text-sm text-foreground line-clamp-2">
            {titleItem.text as string}
          </p>
        )}
        {bodyItems.map((item, i) => (
          <p key={i} className="text-muted-foreground line-clamp-2">
            {item.text as string}
          </p>
        ))}
      </div>
      {action && (
        <div className="px-3 pb-3">
          <div className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 py-1.5 text-center text-xs font-medium shadow-sm">
            {(action.label as string) || 'ดูเพิ่มเติม'}
          </div>
        </div>
      )}
    </div>
  );
}
