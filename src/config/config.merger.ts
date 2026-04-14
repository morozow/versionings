// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export interface ConfigSource {
  name: string;  // 'defaults' | 'version.json' | '.versioningsrc' | etc.
  data: Record<string, any>;
  filePath?: string;
}

export interface ConfigProvenance {
  [fieldPath: string]: {
    value: any;
    source: string;
  };
}

function isPlainObject(val: unknown): val is Record<string, any> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function collectProvenance(
  obj: Record<string, any>,
  source: string,
  prefix: string,
  provenance: ConfigProvenance,
): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      collectProvenance(val, source, path, provenance);
    } else {
      provenance[path] = { value: val, source };
    }
  }
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val === undefined) {
      continue;
    }
    if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Deep merge массива источников конфигурации.
 * Источники применяются в порядке массива (последний побеждает).
 * Отслеживает provenance каждого leaf-поля.
 */
export function mergeConfigs(sources: ConfigSource[]): {
  merged: Record<string, any>;
  provenance: ConfigProvenance;
} {
  if (sources.length === 0) {
    return { merged: {}, provenance: {} };
  }

  let merged: Record<string, any> = {};
  const provenance: ConfigProvenance = {};

  for (const src of sources) {
    merged = deepMerge(merged, src.data);
    collectProvenance(src.data, src.name, '', provenance);
  }

  return { merged, provenance };
}
