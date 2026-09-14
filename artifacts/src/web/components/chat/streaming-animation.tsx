import { useRef, type ComponentProps, type CSSProperties } from 'react';
import type { ExtraProps } from 'streamdown';

/** Animate newly arrived characters together, without buffering or replaying the network stream. */
export const STREAMING_ANIMATION = { animation: 'fadeIn', duration: 800, sep: 'char', stagger: 0 } as const;

export function StreamingSpan({ node: _node, style, ...props }: ComponentProps<'span'> & ExtraProps) {
  const duration = (style as CSSProperties & { '--sd-duration'?: string })?.['--sd-duration'];
  // Streamdown marks prior tokens as 0ms on append, which would prematurely finish their active fades.
  // Completion only changes the next chunk's render; a ref avoids one React commit per finished token.
  const activeDuration = useRef('data-sd-animate' in props && duration !== '0ms' ? duration : undefined);
  return <span {...props} style={activeDuration.current ? { ...style, '--sd-duration': activeDuration.current } as CSSProperties : style} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'sd-fadeIn') activeDuration.current = undefined; props.onAnimationEnd?.(event); }} />;
}
