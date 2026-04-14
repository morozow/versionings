'use strict';

/**
 * Recursively merges two objects.
 * Properties from source overwrite properties in target.
 * Nested objects are merged recursively; arrays are replaced entirely.
 *
 * @param {Object} target - the target object
 * @param {Object} source - the source object
 * @returns {Object} a new object containing the merged result
 */
function deepMerge(target, source) {
  const result = {};

  const allKeys = new Set([
    ...Object.keys(target),
    ...Object.keys(source),
  ]);

  for (const key of allKeys) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (key in source && key in target) {
      if (
        isPlainObject(targetVal) &&
        isPlainObject(sourceVal)
      ) {
        result[key] = deepMerge(targetVal, sourceVal);
      } else {
        result[key] = cloneDeep(sourceVal);
      }
    } else if (key in source) {
      result[key] = cloneDeep(sourceVal);
    } else {
      result[key] = cloneDeep(targetVal);
    }
  }

  return result;
}

/**
 * Deep-clones a value via JSON serialization.
 * Does not support functions, undefined, Date, RegExp, or circular references.
 *
 * @param {*} obj - the value to clone
 * @returns {*} a deep copy of the value
 */
function cloneDeep(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Performs a deep equality comparison of two values.
 * Supports primitives, arrays, and plain objects.
 *
 * @param {*} a - the first value
 * @param {*} b - the second value
 * @returns {boolean} true if the values are deeply equal
 */
function isEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (
    a === null || b === null ||
    typeof a !== 'object' || typeof b !== 'object'
  ) {
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => isEqual(item, b[index]));
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && isEqual(a[key], b[key])
  );
}

/**
 * Checks whether a value is a plain object (not an array, not null).
 *
 * @param {*} val
 * @returns {boolean}
 */
function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

module.exports = { deepMerge, cloneDeep, isEqual };
