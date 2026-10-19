import type { SVGProps } from 'react'
type Props = SVGProps<SVGSVGElement> & { size?: number }
const paths = {
  Home: 'm3 10 9-7 9 7v10H3Z M9 20v-7h6v7',
  Inbox: 'M4 4h16l2 12v4H2v-4Z M2 16h6l2 3h4l2-3h6',
  CheckSquare: 'M9 11l3 3L22 4 M21 12v8H3V2h14',
  ChevronRight: 'm9 5 7 7-7 7',
  ChevronDown: 'm5 9 7 7 7-7',
  Plus: 'M12 5v14 M5 12h14',
  List: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  Check: 'm5 12 4 4L19 6',
  Share2:
    'M8 11l8-5 M8 13l8 5 M5 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M19 2a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M19 16a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  Settings2: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M13 4v6 M7 14v6',
  RefreshCw: 'M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5',
  SlidersHorizontal: 'M3 6h4 M11 6h10 M3 12h10 M17 12h4 M3 18h4 M11 18h10 M7 3v6 M17 9v6 M7 15v6',
  X: 'm6 6 12 12 M6 18 18 6',
}
function icon(name: keyof typeof paths) {
  return function Icon({ size = 20, ...props }: Props) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={paths[name]} />
      </svg>
    )
  }
}
export const Home = icon('Home'),
  Inbox = icon('Inbox'),
  CheckSquare = icon('CheckSquare'),
  ChevronRight = icon('ChevronRight'),
  ChevronDown = icon('ChevronDown'),
  Plus = icon('Plus'),
  List = icon('List'),
  Check = icon('Check'),
  Share2 = icon('Share2'),
  Settings2 = icon('Settings2'),
  RefreshCw = icon('RefreshCw'),
  SlidersHorizontal = icon('SlidersHorizontal'),
  X = icon('X')
