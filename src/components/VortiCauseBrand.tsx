import './vorticause-brand.css'

export function VortiPressIcon() {
  return (
    <svg
      className="vorticause-icon"
      viewBox="0 0 40 40"
      role="img"
      aria-label="VortiPress"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="11" fill="#6d4aff" />
      <path
        d="m5 13 6 15 6-15M21 28V13h6a5 5 0 0 1 0 10h-6"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function VortiPressLogo() {
  return (
    <div className="vorticause-wordmark">
      <VortiPressIcon />
      <span>VortiPress</span>
    </div>
  )
}
