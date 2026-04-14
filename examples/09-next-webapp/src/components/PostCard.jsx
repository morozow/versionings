export default function PostCard({ title, excerpt, date, author }) {
  const formattedDate = new Date(date).toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <article style={styles.card}>
      <h2 style={styles.title}>{title}</h2>
      <p style={styles.excerpt}>{excerpt}</p>
      <footer style={styles.meta}>
        <span>{author}</span>
        <time dateTime={date}>{formattedDate}</time>
      </footer>
    </article>
  );
}

const styles = {
  card: {
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '16px',
    backgroundColor: '#fff',
    transition: 'box-shadow 0.2s ease',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '1.25rem',
    color: '#1a1a1a',
  },
  excerpt: {
    margin: '0 0 16px 0',
    color: '#555',
    lineHeight: '1.6',
  },
  meta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    color: '#888',
  },
};
