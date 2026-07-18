import type { CSSProperties, ReactNode } from 'react'

interface BubbleCardProps {
  title: string
  accent: string
  children: ReactNode
  style?: CSSProperties
}

export function BubbleCard({ title, accent, children, style }: BubbleCardProps) {
  return (
    <section
      data-window-interactive
      aria-label={title}
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        padding: '10px 11px',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.72)',
        borderRadius: 16,
        background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(244, 248, 255, 0.86))',
        boxShadow: `0 12px 34px rgba(33, 47, 74, 0.16), inset 3px 0 0 ${accent}`,
        backdropFilter: 'blur(16px)',
        color: '#1f2a44',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          marginBottom: 7,
          color: '#667085',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      {children}
    </section>
  )
}
