/**
 * Recursively search and convert BigInt values to strings in any object or array.
 * This is essential for Cloudflare D1 results and AI SDK compatibility,
 * as standard JSON.stringify crashes on BigInt.
 */
export function sanitizeData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString() as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeData(value);
    }
    return sanitized as T;
  }

  return data;
}
