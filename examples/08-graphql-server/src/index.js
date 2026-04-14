const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { typeDefs } = require('./schema/typeDefs');
const { resolvers } = require('./schema/resolvers');
const { BooksDataSource } = require('./datasources/books');

async function startServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers
  });

  const booksDataSource = new BooksDataSource();

  const { url } = await startStandaloneServer(server, {
    listen: { port: Number(process.env.PORT) || 4000 },
    context: async () => ({
      dataSources: {
        books: booksDataSource
      }
    })
  });

  console.log(`GraphQL server ready at ${url}`);
}

startServer();
