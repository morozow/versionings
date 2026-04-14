const resolvers = {
  Query: {
    books: (_parent, _args, { dataSources }) => {
      return dataSources.books.getAll();
    },
    book: (_parent, { id }, { dataSources }) => {
      return dataSources.books.getById(id);
    }
  },
  Mutation: {
    addBook: (_parent, args, { dataSources }) => {
      return dataSources.books.add(args);
    },
    removeBook: (_parent, { id }, { dataSources }) => {
      return dataSources.books.remove(id);
    }
  }
};

module.exports = { resolvers };
