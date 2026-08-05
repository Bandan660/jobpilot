import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Stagger step, matching the [data-delay] rules in motion.css. */
  delay?: 1 | 2 | 3;
  className?: string;
  as?: ElementType;
  /**
   * Skip the fade and render visible immediately. Use for anything above the
   * fold — a hidden LCP element costs real Lighthouse points.
   */
  immediate?: boolean;
  /** Extra attributes (data-span, data-accent…) forwarded to the element. */
  [key: `data-${string}`]: unknown;
}

/**
 * Fades content up the first time it enters the viewport.
 *
 * Reveals once and then disconnects — re-animating on every scroll past is
 * distracting, and it keeps a long page from holding dozens of live observers.
 * If IntersectionObserver is unavailable the content is shown immediately
 * rather than left invisible.
 */
export function Reveal({
  children,
  delay,
  className = '',
  as: Tag = 'div',
  immediate = false,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (immediate) return;
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      // Fires slightly before the element is fully on screen, so the motion
      // has finished by the time the reader reaches it.
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [immediate]);

  return (
    <Tag
      ref={ref}
      {...rest}
      data-delay={delay}
      data-immediate={immediate || undefined}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
