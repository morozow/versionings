const typeDefs = `#graphql
  type Book {
    id: ID!
    title: String!
    author: String!
    year: Int
    isbn: String
  }

  type Query {
    books: [Book!]!
    book(id: ID!): Book
  }

  type Mutation {
    addBook(title: String!, author: String!, year: Int, isbn: String): Book!
    removeBook(id: ID!): Boolean!
  }
`;

module.exports = { typeDefs };
