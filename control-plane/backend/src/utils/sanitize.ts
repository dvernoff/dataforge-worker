export function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    return input.replace(/[<>]/g, '');
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (input && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = sanitizeInput(value);
    }
    return result;
  }
  return input;
}
