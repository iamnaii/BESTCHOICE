import { useRef } from 'react';
import { useScrollReveal } from './useScrollReveal';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  once?: boolean;
  rootMargin?: string;
}

export function Reveal({
  once = true,
  rootMargin = '0px 0px -10% 0px',
  className,
  children,
  ...props
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollReveal(ref, { once, rootMargin });

  return (
    <div ref={ref} className={className} {...props}>
      {children}
    </div>
  );
}
