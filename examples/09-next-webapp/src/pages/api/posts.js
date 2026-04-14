const posts = [
  {
    id: 1,
    title: 'Getting Started with Next.js',
    excerpt: 'Next.js is a React framework that provides server-side rendering, file-based routing, and built-in optimizations out of the box.',
    date: '2024-06-01',
    author: 'Anna Smith'
  },
  {
    id: 2,
    title: 'API Routes in Next.js',
    excerpt: 'API Routes let you create server-side endpoints directly inside a Next.js application without a separate backend.',
    date: '2024-06-10',
    author: 'David Clark'
  },
  {
    id: 3,
    title: 'Deploying Next.js with Bitbucket Pipelines',
    excerpt: 'A step-by-step guide to setting up CI/CD for a Next.js application using Bitbucket Pipelines.',
    date: '2024-06-18',
    author: 'Elena Walker'
  },
  {
    id: 4,
    title: 'Server-Side Rendering and getServerSideProps',
    excerpt: 'A deep dive into the SSR mechanism in Next.js: when to use getServerSideProps versus getStaticProps.',
    date: '2024-06-25',
    author: 'Anna Smith'
  }
];

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  return res.status(200).json(posts);
}
