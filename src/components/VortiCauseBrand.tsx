import './vorticause-brand.css'

export function VortiCauseIcon() {
  return (
    <svg
      className="vorticause-icon"
      viewBox="0 0 40 40"
      role="img"
      aria-label="VortiCause"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="11" fill="#6d4aff" />
      <path
        d="m7 13 5 15 5-15M31 14a8 8 0 1 0 0 12"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function VortiCauseLogo() {
  return (
    <div className="vorticause-wordmark">
      <VortiCauseIcon />
      <span>VortiCause</span>
    </div>
  )
}
