import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) io.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [once, rootMargin]);

  return (
    <div ref={ref} className={cn('reveal', visible && 'in-view', className)} {...props}>
      {children}
    </div>
  );
}
