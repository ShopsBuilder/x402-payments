/**
 * @shopsbuilder/x402/client
 *
 * Client-side helpers for consuming x402-protected endpoints
 * backed by the ShopsBuilder multichain-invoice-api.
 *
 * The payment flow for invoice-backed x402:
 *
 *  1. Client makes a request → server returns HTTP 402
 *  2. Client decodes PAYMENT-REQUIRED header → reads `extra.paymentUrl`
 *  3. Client opens `t.me/InvoiceGbot/pay?startapp=i_{id}` in Telegram
 *  4. User completes payment in Telegram
 *  5. Client builds InvoicePaymentProof and retries with PAYMENT-SIGNATURE header
 *  6. Server verifies on-chain → returns 200
 *
 * @example
 * ```typescript
 * import { parse402Response, buildPaymentSignatureHeader } from '@shopsbuilder/x402/client';
 *
 * const res = await fetch('/api/premium');
 * if (res.status === 402) {
 *   const req = parse402Response(res.headers);
 *   const accept = req.accepts[0];
 *
 *   // Open Telegram bot for payment
 *   const telegramUrl = accept.extra.paymentUrl as string;
 *   window.open(telegramUrl);   // or deeplink for mobile
 *
 *   // After user pays, build proof and retry
 *   const sig = buildPaymentSignatureHeader({
 *     paymentLinkId: accept.extra.paymentLinkId as number,
 *     idBytes16:     accept.extra.idBytes16 as string,
 *     chainId:       -1,            // TON mainnet
 *     payerAddress:  myTonAddress,
 *     status:        'AUTHORIZED',
 *   });
 *   const paid = await fetch('/api/premium', {
 *     headers: { 'PAYMENT-SIGNATURE': sig },
 *   });
 * }
 * ```
 */

import { decodeBase64Json, encodeBase64Json } from '../utils';
import type { PaymentRequired } from '../types';

export type { PaymentRequired, PaymentAccept, AcceptsExtra } from '../types';
export { X402Error } from '../types';
export { decodeBase64Json, encodeBase64Json } from '../utils';

// ─── Parse 402 response ───────────────────────────────────────────────────────

/**
 * Decode the PAYMENT-REQUIRED header from an HTTP 402 response.
 * Works with both the Web Fetch API Headers object and plain header maps.
 */
export function parse402Response(
  headers: Headers | Record<string, string | undefined>,
): PaymentRequired {
  const raw =
    headers instanceof Headers
      ? headers.get('payment-required') ?? headers.get('PAYMENT-REQUIRED')
      : headers['payment-required'] ?? headers['PAYMENT-REQUIRED'];

  if (!raw) {
    throw new Error('Response is missing PAYMENT-REQUIRED header');
  }
  return decodeBase64Json<PaymentRequired>(raw);
}

/**
 * Extract the Telegram payment URL from a PaymentRequired object.
 * Returns the first `extra.paymentUrl` found across all accepts.
 */
export function extractPaymentUrl(requirements: PaymentRequired): string | null {
  for (const accept of requirements.accepts) {
    const url = accept.extra['paymentUrl'];
    if (typeof url === 'string' && url.length > 0) return url;
  }
  return null;
}

// ─── Build PAYMENT-SIGNATURE header ──────────────────────────────────────────

export interface InvoicePaymentProofInput {
  paymentLinkId: number;
  idBytes16: string;
  chainId: number;
  payerAddress: string;
  /** Payment status reported by the Telegram bot / webhook, default 'AUTHORIZED' */
  status?: string;
}

/**
 * Encode an InvoicePaymentProof into a base64 string suitable for the
 * `PAYMENT-SIGNATURE` request header.
 */
export function buildPaymentSignatureHeader(proof: InvoicePaymentProofInput): string {
  return encodeBase64Json({
    x402Version: 2,
    paymentLinkId: proof.paymentLinkId,
    idBytes16: proof.idBytes16,
    chainId: proof.chainId,
    payerAddress: proof.payerAddress,
    status: proof.status ?? 'AUTHORIZED',
  });
}

/**
 * Decode a PAYMENT-SIGNATURE header back to a proof object.
 */
export function decodePaymentSignatureHeader(header: string): ReturnType<typeof decodeBase64Json> {
  return decodeBase64Json(header);
}

// ─── Poll helper ──────────────────────────────────────────────────────────────

/**
 * Retry a fetch request with a payment signature until it succeeds or
 * `maxRetries` is exhausted.  Useful in automation / testing scenarios.
 *
 * @param url      - Resource URL
 * @param signatureHeader - base64 PAYMENT-SIGNATURE string
 * @param options  - Standard RequestInit merged with the signature header
 * @param maxRetries - How many times to retry (default 5)
 * @param intervalMs - Delay between retries in ms (default 2000)
 */
export async function fetchWithPaymentSignature(
  url: string,
  signatureHeader: string,
  options: RequestInit = {},
  maxRetries = 5,
  intervalMs = 2000,
): Promise<Response> {
  const headers = new Headers(options.headers as RequestInit['headers']);
  headers.set('PAYMENT-SIGNATURE', signatureHeader);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, { ...options, headers });
    if (res.status !== 402) return res;
    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Request still 402 after ${maxRetries} retries`);
}
