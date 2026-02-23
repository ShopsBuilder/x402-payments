/**
 * @shopsbuilder/x402 — Utilities
 */

// ─── Base64 JSON encoding (Unicode-safe, Node + browser) ─────────────────────

function safeBase64Encode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function safeBase64Decode(encoded: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Json(obj: unknown): string {
  return safeBase64Encode(JSON.stringify(obj));
}

export function decodeBase64Json<T>(encoded: string): T {
  return JSON.parse(safeBase64Decode(encoded)) as T;
}

// ─── Amount helpers ───────────────────────────────────────────────────────────

/** Convert human-readable amount to atomic units string.
 *  e.g. toAtomicUnits(1.5, 9) → '1500000000'
 */
export function toAtomicUnits(amount: number, decimals: number): string {
  return Math.floor(amount * Math.pow(10, decimals)).toString();
}

/** Convert atomic units back to human-readable number.
 *  e.g. fromAtomicUnits('1500000000', 9) → 1.5
 */
export function fromAtomicUnits(atomic: string | number | bigint, decimals: number): number {
  return Number(atomic) / Math.pow(10, decimals);
}
