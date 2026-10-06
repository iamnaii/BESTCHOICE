import { createContext } from 'react';

/** The inbox owns its actions; the app shell only provides their desktop slot. */
export const InboxNavigationContext = createContext<{
  host: HTMLDivElement | null;
  setHost: (element: HTMLDivElement | null) => void;
} | null>(null);
