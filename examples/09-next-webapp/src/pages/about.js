import Layout from '../components/Layout';
import packageJson from '../../package.json';

export default function About() {
  return (
    <Layout>
      <h1 style={{ marginBottom: '24px' }}>About</h1>

      <section style={styles.section}>
        <h2 style={styles.heading}>09-next-webapp</h2>
        <p style={styles.text}>
          A demo Next.js application integrated with Bitbucket Server
          and the versionings tool for automated semantic versioning.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Technology Stack</h2>
        <ul style={styles.list}>
          <li>Next.js 14 — React framework with SSR</li>
          <li>React 18 — UI component library</li>
          <li>Bitbucket Server — SCM platform</li>
          <li>versionings — release automation</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Version</h2>
        <p style={styles.version}>v{packageJson.version}</p>
      </section>
    </Layout>
  );
}

const styles = {
  section: {
    marginBottom: '32px',
  },
  heading: {
    fontSize: '1.25rem',
    marginBottom: '12px',
    color: '#1a1a1a',
  },
  text: {
    color: '#555',
    lineHeight: '1.6',
  },
  list: {
    color: '#555',
    lineHeight: '2',
    paddingLeft: '24px',
  },
  version: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#0052cc',
  },
};
