import { Children, useRef } from 'react';
import { useScrollReveal } from './useScrollReveal';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  stagger?: number;
}

export function StaggerChildren({ stagger = 70, className, children, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollReveal(ref, { stagger, childCount: Children.count(children) });
  return (
    <div ref={ref} className={className} {...props}>
      {Children.map(children, (child) => (
        <div className="h-full">{child}</div>
      ))}
    </div>
  );
}
