const fs = require('fs');
const { formatTable } = require('../utils/format');

module.exports = {
  command: 'count <file>',
  describe: 'Count words, lines, and characters in a file',
  builder: (yargs) =>
    yargs
      .positional('file', {
        type: 'string',
        describe: 'Path to the file',
      })
      .option('words', {
        alias: 'w',
        type: 'boolean',
        default: false,
        describe: 'Count words',
      })
      .option('lines', {
        alias: 'l',
        type: 'boolean',
        default: false,
        describe: 'Count lines',
      })
      .option('chars', {
        alias: 'c',
        type: 'boolean',
        default: false,
        describe: 'Count characters',
      }),
  handler: (argv) => {
    const filePath = argv.file;

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const showAll = !argv.words && !argv.lines && !argv.chars;

    const results = { file: filePath };

    if (showAll || argv.lines) {
      results.lines = content.split('\n').length;
    }
    if (showAll || argv.words) {
      results.words = content.split(/\s+/).filter(Boolean).length;
    }
    if (showAll || argv.chars) {
      results.chars = content.length;
    }

    console.log(formatTable(results));
  },
};
