'use client'

import { useRef } from 'react'
import styles from './NewsList.module.css'

export function NewsSlider({ children, label = 'Notizie' }: { children: React.ReactNode; label?: string }) {
  const trackRef = useRef<HTMLUListElement>(null)

  function scrollByCard(direction: 1 | -1) {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.8, 260), behavior: 'smooth' })
  }

  return (
    <div className={styles.slider}>
      <div className={styles.arrows}>
        <button type="button" className={styles.arrow} onClick={() => scrollByCard(-1)} aria-label={`${label} precedenti`}>
          ‹
        </button>
        <button type="button" className={styles.arrow} onClick={() => scrollByCard(1)} aria-label={`${label} successivi`}>
          ›
        </button>
      </div>
      <ul className={styles.list} ref={trackRef} tabIndex={0} aria-label={`${label} recenti`}>
        {children}
      </ul>
    </div>
  )
}
