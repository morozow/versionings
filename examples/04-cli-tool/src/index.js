#!/usr/bin/env node

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const greetCommand = require('./commands/greet');
const countCommand = require('./commands/count');

yargs(hideBin(process.argv))
  .scriptName('mytool')
  .usage('$0 <command> [options]')
  .command(greetCommand)
  .command(countCommand)
  .strictCommands()
  .demandCommand(1, 'Please specify a command. Use --help to see available commands.')
  .alias('h', 'help')
  .alias('v', 'version')
  .parse();
