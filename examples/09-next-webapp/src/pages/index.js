import Layout from '../components/Layout';
import PostCard from '../components/PostCard';

export async function getServerSideProps({ req }) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const res = await fetch(`${protocol}://${host}/api/posts`);
  const posts = await res.json();

  return { props: { posts } };
}

export default function Home({ posts }) {
  return (
    <Layout>
      <h1 style={{ marginBottom: '24px' }}>Blog</h1>
      <p style={{ color: '#555', marginBottom: '32px' }}>
        Latest posts on Next.js, CI/CD, and web development.
      </p>
      {posts.map((post) => (
        <PostCard
          key={post.id}
          title={post.title}
          excerpt={post.excerpt}
          date={post.date}
          author={post.author}
        />
      ))}
    </Layout>
  );
}
