/**
 * @shopsbuilder/x402 — Shared Protocol Types
 *
 * Core x402 v2 types used across server and client modules.
 * The x402 protocol: a server returns HTTP 402 with a PAYMENT-REQUIRED header;
 * the client pays and retries with a PAYMENT-SIGNATURE header.
 */

// ─── Payment structures ───────────────────────────────────────────────────────

/**
 * Extra fields embedded in a PaymentAccept entry.
 * For invoice-backed payments the key field is `paymentUrl`.
 */
export interface AcceptsExtra {
  /** Telegram bot payment URL: t.me/InvoiceGbot/pay?startapp=i_{id} */
  paymentUrl?: string;
  /** Invoice API payment link ID */
  paymentLinkId?: number;
  /** Deterministic 16-byte hex ID for this payment */
  idBytes16?: string;
  /** On-chain escrow contract address */
  escrowAddress?: string;
  /** Contract address on the target chain */
  contractAddress?: string;
  /** Operator address responsible for settlement */
  operatorAddress?: string;
  /** Ed25519 / EVM operator signature */
  signature?: string;
  /** Platform fee in atomic units */
  feeAmount?: string;
  /** Refund destination address */
  refundDestination?: string;
  /** Any additional chain-specific fields */
  [key: string]: unknown;
}

/** Resource being protected by a payment gate */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

/** One payment option advertised in a 402 response */
export interface PaymentAccept {
  x402Version?: 2;
  /** Always 'exact' */
  scheme: 'exact';
  /** CAIP-2 network string, e.g. 'ton:-1' or 'eip155:8453' */
  network: string;
  /** Amount in atomic units */
  maxAmountRequired: string;
  /** Token address on the target chain */
  asset: string;
  /** Seller / recipient address */
  payTo: string;
  /** Seconds until this payment intent expires */
  maxTimeoutSeconds: number;
  extra: AcceptsExtra;
}

/** Full structure sent in the PAYMENT-REQUIRED header (base64 JSON) */
export interface PaymentRequired {
  x402Version: 2;
  resource: ResourceInfo;
  accepts: PaymentAccept[];
  error?: string;
}

/** Structure the client sends in the PAYMENT-SIGNATURE header (base64 JSON) */
export interface PaymentSignature {
  x402Version: 2;
  paymentLinkId: number;
  idBytes16: string;
  chainId: number;
  payerAddress: string;
  status: string;
}

// ─── Server response types ────────────────────────────────────────────────────

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction?: string;
  network: string;
  errorReason?: string;
  payer?: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export type X402ErrorCode =
  | 'invalid_payment_signature'
  | 'payment_not_found'
  | 'payment_status_invalid'
  | 'missing_payment_required_header'
  | 'invalid_payment_required'
  | 'settle_failed'
  | 'graphql_error';

export class X402Error extends Error {
  code: X402ErrorCode;
  details?: unknown;

  constructor(code: X402ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'X402Error';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, X402Error.prototype);
  }
}
