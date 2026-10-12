import type { CSSProperties } from 'react'
export const separatorPaths: Record<string, string> = {
  straight: 'M0 0H100V12H0Z',
  wave: 'M0 6Q25 0 50 6T100 6V12H0Z',
  'wave-2': 'M0 8Q15 0 30 8T60 8T100 8V12H0Z',
  'wave-3': 'M0 2Q25 12 50 2T100 2V12H0Z',
  'wave-4': 'M0 9C20 12 25 0 50 6S80 12 100 2V12H0Z',
  angle: 'M0 12L100 0V12Z',
  'slant-2': 'M0 0L100 12H0Z',
  curve: 'M0 0Q50 24 100 0V12H0Z',
  'curve-2': 'M0 12Q50 -12 100 12Z',
  'curve-3': 'M0 0Q0 12 100 12H0Z',
  'rounded-1': 'M0 0Q0 12 12 12H88Q100 12 100 0V12H0Z',
  'rounded-2': 'M0 12Q0 0 12 0H88Q100 0 100 12Z',
  'rounded-3': 'M0 0Q50 12 100 0V12H0Z',
}
export type SeparatorSettings = {
  shape: string
  height?: number
  width?: number
  color?: string
  flip?: boolean
  layers?: number
  shadow?: boolean
}
export function Separator({
  settings,
  style,
}: {
  settings: SeparatorSettings
  style?: CSSProperties
}) {
  const count = Math.max(1, Math.min(3, Math.round(settings.layers ?? 1)))
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{
        display: 'block',
        width: `${settings.width ?? 100}%`,
        height: `${settings.height ?? 48}px`,
        color: settings.color,
        transform: settings.flip ? 'rotate(180deg)' : undefined,
        filter: settings.shadow ? 'drop-shadow(0 3px 3px #0004)' : undefined,
        ...style,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <path
          key={i}
          fill="currentColor"
          opacity={(i + 1) / count}
          transform={`translate(0,${(count - i - 1) * -1.5})`}
          d={separatorPaths[settings.shape] ?? separatorPaths.wave}
        />
      ))}
    </svg>
  )
}
