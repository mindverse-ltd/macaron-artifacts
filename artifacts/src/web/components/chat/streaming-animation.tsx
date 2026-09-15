import { useRef, type ComponentProps, type CSSProperties } from 'react';
import type { ExtraProps } from 'streamdown';

/** Animate newly arrived characters together, without buffering or replaying the network stream. */
export const STREAMING_ANIMATION = { animation: 'fadeIn', duration: 800, sep: 'char', stagger: 0 } as const;

export function StreamingSpan({ node: _node, style, ...props }: ComponentProps<'span'> & ExtraProps) {
  const timing = style as CSSProperties & { '--sd-duration'?: string; '--sd-animation'?: string } | undefined, duration = timing?.['--sd-duration'];
  // Streamdown marks prior tokens as 0ms on append, which would prematurely finish their active fades.
  // Completion only changes the next chunk's render; a ref avoids one React commit per finished token.
  const activeDuration = useRef('data-sd-animate' in props && duration !== '0ms' ? duration : undefined);
  // Default fades end at the underlying opacity of 1. Keeping forwards fill retains thousands of finished effects during later style updates.
  // Backwards fill preserves delayed entry and native animationend; custom opacity or animation styles retain their own lifecycle.
  const releaseFade = 'data-sd-animate' in props && !props.className && (!timing?.['--sd-animation'] || timing['--sd-animation'] === 'sd-fadeIn') && style?.opacity == null && style?.animation == null && style?.animationName == null && style?.animationFillMode == null;
  const spanStyle = activeDuration.current || releaseFade ? { ...(releaseFade ? { animationFillMode: 'backwards' } : {}), ...style, ...(activeDuration.current ? { '--sd-duration': activeDuration.current } : {}) } as CSSProperties : style;
  return <span {...props} style={spanStyle} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'sd-fadeIn') activeDuration.current = undefined; props.onAnimationEnd?.(event); }} />;
}
