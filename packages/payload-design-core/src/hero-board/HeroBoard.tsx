import type { DesignPrimitive } from '../types'
import './hero-board.css'

export type HeroMedia = { url: string; alt: string }
export type HeroBoardValues = {
  eyebrow?: string
  headline: string
  subheadline?: string
  backgroundImage?: HeroMedia
  foregroundImage?: HeroMedia
  primaryCTA?: { label: string; url: string }
  secondaryCTA?: { label: string; url: string }
}

function safeURL(url?: string): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//.test(url) || /^\/(?!\/)/.test(url) ? url : undefined
}

export function HeroBoardRenderer({ design, values, headingLevel = 2 }: { design: DesignPrimitive; values: HeroBoardValues; headingLevel?: 1 | 2 | 3 }) {
  const Heading = `h${headingLevel}` as const
  const treatment = design.imageTreatment ?? 'background'
  const classes = [
    'hero-board', `hero-board--${treatment}`, `hero-board--${design.width ?? 'wide'}`,
    `hero-board--${design.spacing ?? 'large'}`, `hero-board--align-${design.alignment ?? 'left'}`,
    `hero-board--overlay-${design.overlay ?? 'dark'}`, `hero-board--text-${design.textContrast ?? 'light'}`,
  ].join(' ')
  const background = safeURL(values.backgroundImage?.url)
  const foreground = safeURL(values.foregroundImage?.url)
  return <section className={classes} aria-label={values.headline}>
    {background && treatment !== 'split' && <img className="hero-board__background" src={background} alt={values.backgroundImage?.alt || ''} />}
    <div className="hero-board__overlay" aria-hidden="true" />
    <div className="hero-board__inner">
      <div className="hero-board__copy">
        {values.eyebrow && <p className="hero-board__eyebrow">{values.eyebrow}</p>}
        <Heading className="hero-board__headline">{values.headline}</Heading>
        {values.subheadline && <p className="hero-board__subheadline">{values.subheadline}</p>}
        <div className="hero-board__actions">
          {[values.primaryCTA, values.secondaryCTA].map((cta, index) => {
            const href = safeURL(cta?.url)
            return href && cta?.label ? <a key={index} className={`hero-board__button hero-board__button--${index === 0 ? design.buttonStyle ?? 'primary' : 'outline'}`} href={href}>{cta.label}</a> : null
          })}
        </div>
      </div>
      {foreground && (treatment === 'split' || treatment === 'feature') && <img className="hero-board__foreground" src={foreground} alt={values.foregroundImage?.alt || ''} />}
    </div>
  </section>
}
