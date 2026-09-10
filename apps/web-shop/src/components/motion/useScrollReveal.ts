import type { RefObject } from 'react';
import { gsap, useGSAP } from './gsap';

interface Options {
  once?: boolean;
  rootMargin?: string;
  stagger?: number;
  childCount?: number;
}

/** Content is visible by default, including prerendered HTML and reduced motion. */
export function useScrollReveal(
  ref: RefObject<HTMLDivElement | null>,
  { once = true, rootMargin = '0px 0px -8% 0px', stagger = 0, childCount }: Options = {},
) {
  useGSAP(
    () => {
      const node = ref.current;
      if (!node || !window.matchMedia || !window.IntersectionObserver) return;

      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const targets = childCount === undefined ? [node] : Array.from(node.children);
        if (!targets.length) return;

        const animation = gsap.fromTo(
          targets,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.65,
            stagger: stagger / 1000,
            ease: 'power2.out',
            paused: true,
            clearProps: 'opacity,transform',
          },
        );
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              animation.play();
              if (once) observer.disconnect();
            } else if (!once) {
              animation.pause(0);
            }
          },
          { rootMargin },
        );

        // Tab navigation must never focus an invisible call to action.
        const revealOnFocus = () => {
          animation.progress(1);
          if (once) observer.disconnect();
        };
        observer.observe(node);
        node.addEventListener('focusin', revealOnFocus);
        return () => {
          observer.disconnect();
          node.removeEventListener('focusin', revealOnFocus);
        };
      });
      return () => media.revert();
    },
    { scope: ref, dependencies: [once, rootMargin, stagger, childCount], revertOnUpdate: true },
  );
}
