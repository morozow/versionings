const crypto = require('crypto');

const initialBooks = [
  {
    id: '1',
    title: 'War and Peace',
    author: 'Leo Tolstoy',
    year: 1869,
    isbn: '978-0-14-044793-4'
  },
  {
    id: '2',
    title: 'Crime and Punishment',
    author: 'Fyodor Dostoevsky',
    year: 1866,
    isbn: '978-0-14-044913-6'
  },
  {
    id: '3',
    title: 'The Master and Margarita',
    author: 'Mikhail Bulgakov',
    year: 1967,
    isbn: '978-0-14-118014-1'
  }
];

class BooksDataSource {
  constructor() {
    this.books = [...initialBooks];
  }

  getAll() {
    return this.books;
  }

  getById(id) {
    return this.books.find((book) => book.id === id) || null;
  }

  add(data) {
    const book = {
      id: crypto.randomUUID(),
      title: data.title,
      author: data.author,
      year: data.year || null,
      isbn: data.isbn || null
    };
    this.books.push(book);
    return book;
  }

  remove(id) {
    const index = this.books.findIndex((book) => book.id === id);
    if (index === -1) {
      return false;
    }
    this.books.splice(index, 1);
    return true;
  }
}

module.exports = { BooksDataSource };
