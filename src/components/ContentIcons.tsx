import type { CSSProperties } from 'react'
type IconProps = { size?: number; style?: CSSProperties }
function Icon({ path, size = 18, style }: IconProps & { path: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}
export const ChevronDown = (props: IconProps) => <Icon {...props} path="m6 9 6 6 6-6" />
export const ChevronLeft = (props: IconProps) => <Icon {...props} path="m15 6-6 6 6 6" />
export const ChevronRight = (props: IconProps) => <Icon {...props} path="m9 6 6 6-6 6" />
export const CalendarDays = (props: IconProps) => (
  <Icon
    {...props}
    path="M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 13h2m6 0h2M7 17h2m6 0h2"
  />
)
export const ChartNoAxesGantt = (props: IconProps) => (
  <Icon {...props} path="M3 5h8M7 10h11M12 15h9M5 20h10" />
)
export const List = (props: IconProps) => (
  <Icon {...props} path="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />
)
