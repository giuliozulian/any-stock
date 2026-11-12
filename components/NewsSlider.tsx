'use client'

import { useRef } from 'react'
import styles from './NewsList.module.css'

export function NewsSlider({ children }: { children: React.ReactNode }) {
  const trackRef = useRef<HTMLUListElement>(null)

  function scrollByCard(direction: 1 | -1) {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.8, 260), behavior: 'smooth' })
  }

  return (
    <div className={styles.slider}>
      <div className={styles.arrows}>
        <button type="button" className={styles.arrow} onClick={() => scrollByCard(-1)} aria-label="Notizie precedenti">
          ‹
        </button>
        <button type="button" className={styles.arrow} onClick={() => scrollByCard(1)} aria-label="Notizie successive">
          ›
        </button>
      </div>
      <ul className={styles.list} ref={trackRef} tabIndex={0} aria-label="Notizie recenti">
        {children}
      </ul>
    </div>
  )
}
