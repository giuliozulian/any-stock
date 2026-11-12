interface NewsItemProps {
  id: string
  headline: string
  url: string
  source: string
  publishedAt: Date
}

export function NewsList({ news }: { news: NewsItemProps[] }) {
  if (news.length === 0) {
    return <p>No recent news.</p>
  }

  return (
    <ul>
      {news.map((item) => (
        <li key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.headline}
          </a>{' '}
          — {item.source} ({item.publishedAt.toLocaleDateString()})
        </li>
      ))}
    </ul>
  )
}
