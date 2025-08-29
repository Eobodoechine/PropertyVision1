// server/utils/rapidKey.ts
// Resolve RapidAPI key from header (X-RapidAPI-Key) or environment.
// Use: const key = getRapidApiKey(req)  OR  assertRapidApiKey(req)
export function getRapidApiKey(req?: any): string | undefined {
  const rawHeader =
    req?.headers?.['x-rapidapi-key'] ?? req?.headers?.['X-RapidAPI-Key'];
  const headerKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const envKey = process.env.RAPIDAPI_KEY;
  const key = (typeof headerKey === 'string' && headerKey.trim())
    ? headerKey.trim()
    : (typeof envKey === 'string' && envKey.trim() ? envKey.trim() : undefined);
  return key;
}

export function assertRapidApiKey(req?: any): string {
  const key = getRapidApiKey(req);
  if (!key) {
    throw new Error('RapidAPI key not configured. Provide RAPIDAPI_KEY env or X-RapidAPI-Key header.');
  }
  return key;
}
