/**
 * Merges strings and { className: boolean } objects into a CSS class string.
 *
 * @param {...(string|Object<string, boolean>)} args
 * @returns {string}
 *
 * @example
 * classnames('btn', { 'btn-primary': true, 'btn-disabled': false }, 'extra')
 * // => 'btn btn-primary extra'
 */
function classnames(...args) {
  const classes = [];

  for (const arg of args) {
    if (!arg) continue;

    if (typeof arg === 'string') {
      classes.push(arg);
    } else if (typeof arg === 'object' && !Array.isArray(arg)) {
      for (const [key, value] of Object.entries(arg)) {
        if (value) {
          classes.push(key);
        }
      }
    }
  }

  return classes.join(' ');
}

module.exports = { classnames };
