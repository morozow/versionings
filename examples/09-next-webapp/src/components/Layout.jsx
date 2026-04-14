import Link from 'next/link';
import packageJson from '../../package.json';

export default function Layout({ children }) {
  const version = packageJson.version;

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.logo}>
            09-next-webapp
          </Link>
          <div style={styles.links}>
            <Link href="/" style={styles.link}>Home</Link>
            <Link href="/about" style={styles.link}>About</Link>
          </div>
        </nav>
      </header>

      <main style={styles.main}>
        {children}
      </main>

      <footer style={styles.footer}>
        <span>&copy; {new Date().getFullYear()} 09-next-webapp</span>
        <span>v{version}</span>
      </footer>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#fff',
  },
  nav: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#1a1a1a',
    textDecoration: 'none',
  },
  links: {
    display: 'flex',
    gap: '24px',
  },
  link: {
    color: '#555',
    textDecoration: 'none',
  },
  main: {
    flex: 1,
    maxWidth: '960px',
    margin: '0 auto',
    padding: '32px 24px',
    width: '100%',
  },
  footer: {
    borderTop: '1px solid #e0e0e0',
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    maxWidth: '960px',
    margin: '0 auto',
    width: '100%',
    fontSize: '0.875rem',
    color: '#888',
  },
};
