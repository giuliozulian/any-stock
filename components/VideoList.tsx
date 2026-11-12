import styles from './VideoList.module.css'
import { NewsSlider } from './NewsSlider'
import type { RecentVideo } from '@/lib/youtube'

export function VideoList({ videos }: { videos: RecentVideo[] }) {
  if (videos.length === 0) {
    return <p className={styles.empty}>Nessun video degli ultimi 7 giorni trovato per questo titolo.</p>
  }
  return (
    <NewsSlider label="Video">
      {videos.map((v) => (
        <li key={v.id} className={styles.card}>
          <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.thumbnail} alt="" className={styles.thumb} loading="lazy" />
            <span className={styles.title}>{v.title}</span>
            <span className={styles.meta}>
              {v.channel} · {new Date(v.publishedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
            </span>
          </a>
        </li>
      ))}
    </NewsSlider>
  )
}
