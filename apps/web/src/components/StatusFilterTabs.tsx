interface StatusFilterTabsProps<Status extends string> {
  tabs: readonly { key: Status; label: string }[];
  value: Status;
  onChange: (status: Status) => void;
}

export function StatusFilterTabs<Status extends string>({
  tabs,
  value,
  onChange,
}: StatusFilterTabsProps<Status>) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
            value === tab.key
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
