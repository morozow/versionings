function formatTable(data) {
  const entries = Object.entries(data);
  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));

  const separator = '-'.repeat(maxKeyLen + 20);
  const rows = entries.map(
    ([key, value]) => `${key.padEnd(maxKeyLen)}  │  ${value}`
  );

  return [separator, ...rows, separator].join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function formatPlain(data) {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

module.exports = { formatTable, formatJson, formatPlain };
