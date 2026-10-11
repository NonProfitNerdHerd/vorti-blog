'use client'
import { useEffect } from 'react'
import type { BlockPresentation } from './presentation'
export default function Motion({
  id,
  motion,
}: {
  id: string
  motion: NonNullable<BlockPresentation['motion']>
}): null {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = document.querySelector<HTMLElement>(`[data-motion-id="${CSS.escape(id)}"]`)
    if (!target) return
    const from = {
      transform: `translate(${motion.x ?? 0}px,${motion.y ?? 24}px) scale(${motion.scale ?? 1}) rotate(${motion.rotate ?? 0}deg) skew(${motion.skew ?? 0}deg)`,
      opacity: motion.opacity ?? 0,
      filter: `blur(${motion.blur ?? 0}px)`,
    }
    const to = { transform: 'none', opacity: 1, filter: 'none' }
    let animation: Animation | undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        animation = target.animate([from, to], {
          duration: Math.max(0, motion.duration ?? 0.6) * 1000,
          delay: Math.max(0, motion.delay ?? 0) * 1000,
          easing: motion.easing ?? 'ease-out',
        })
        observer.disconnect()
      }
    })
    if (motion.trigger === 'entrance') observer.observe(target)
    else {
      animation = target.animate([from, to], { duration: 1000, fill: 'both' })
      animation.pause()
      const update = () => {
        const rect = target.getBoundingClientRect()
        if (animation)
          animation.currentTime =
            Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight + rect.height))) * 1000
      }
      update()
      window.addEventListener('scroll', update, { passive: true })
      window.addEventListener('resize', update)
      return () => {
        animation?.cancel()
        window.removeEventListener('scroll', update)
        window.removeEventListener('resize', update)
      }
    }
    return () => {
      observer.disconnect()
      animation?.cancel()
    }
  }, [id, motion])
  return null
}

export function previewBlockMotion(id: string, motion: NonNullable<BlockPresentation['motion']>) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const target = document.querySelector<HTMLElement>(`[data-motion-id="${CSS.escape(id)}"]`)
  target?.animate(
    [
      {
        transform: `translate(${motion.x ?? 0}px,${motion.y ?? 24}px) scale(${motion.scale ?? 1}) rotate(${motion.rotate ?? 0}deg) skew(${motion.skew ?? 0}deg)`,
        opacity: motion.opacity ?? 0,
        filter: `blur(${motion.blur ?? 0}px)`,
      },
      { transform: 'none', opacity: 1, filter: 'none' },
    ],
    {
      duration: Math.max(0, motion.duration ?? 0.6) * 1000,
      delay: Math.max(0, motion.delay ?? 0) * 1000,
      easing: motion.easing ?? 'ease-out',
    },
  )
}
