import styles from './NewsList.module.css'

interface NewsItemProps {
  id: string
  headline: string
  url: string
  source: string
  publishedAt: Date
}

export function NewsList({ news }: { news: NewsItemProps[] }) {
  if (news.length === 0) {
    return <p className={styles.empty}>No recent news.</p>
  }

  return (
    <ul className={styles.list}>
      {news.map((item) => (
        <li key={item.id} className={styles.item}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.headline}>
            {item.headline}
          </a>
          <span className={styles.meta}>
            {item.source}, {item.publishedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </li>
      ))}
    </ul>
  )
}
