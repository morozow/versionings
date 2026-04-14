const { formatPlain } = require('../utils/format');

const greetings = {
  en: (name) => `Hello, ${name}!`,
  ru: (name) => `Привет, ${name}!`,
  de: (name) => `Hallo, ${name}!`,
};

module.exports = {
  command: 'greet',
  describe: 'Greet a user in a selected language',
  builder: (yargs) =>
    yargs
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        describe: 'Name to greet',
      })
      .option('lang', {
        alias: 'l',
        type: 'string',
        choices: ['en', 'ru', 'de'],
        default: 'en',
        describe: 'Greeting language',
      }),
  handler: (argv) => {
    const greeting = greetings[argv.lang](argv.name);
    console.log(formatPlain({ message: greeting }));
  },
};
