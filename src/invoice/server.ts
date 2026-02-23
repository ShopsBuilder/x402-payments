/**
 * Invoice x402 Server
 *
 * Server-side x402 backed by the multichain-invoice-api.
 * Returns 402 with a Telegram bot payment URL instead of raw chain signatures.
 */

import type {
  PaymentRequired,
  PaymentAccept,
  ResourceInfo,
  VerifyResponse,
  SettleResponse,
} from '../types';
import { encodeBase64Json, decodeBase64Json } from '../utils';
import { InvoiceApiClient } from './graphql-client';
import {
  PaymentActions,
  PaymentStatus,
  NetworkType,
} from './types';
import type {
  InvoiceX402ServerConfig,
  InvoicePaymentProof,
  PaymentLink,
  PaymentLinkSignature,
} from './types';

export { InvoiceApiClient };

const DEFAULT_TELEGRAM_BOT_APP_URL = 't.me/InvoiceTbot/pay';
const DEFAULT_TIMEOUT_SECONDS = 300;

// ============================================================================
// Types
// ============================================================================

export interface BuildRequirementsForPayerOptions {
  /** Payment amount in atomic units (e.g., '1000000' for 1 USDC) */
  amount: string | number;
  /** Resource URL being protected */
  resourceUrl: string;
  /** Override token ID (falls back to config.tokenOutId) */
  tokenOutId?: number;
  /** Override capture mode */
  captureMode?: boolean;
  /** Human-readable description */
  description?: string;
  /** Override timeout in seconds */
  timeoutSeconds?: number;
}

export interface InvoiceX402Server {
  buildRequirementsForPayer(
    options: BuildRequirementsForPayerOptions,
    payerAddress?: string,
  ): Promise<PaymentRequired>;

  encodeRequirements(requirements: PaymentRequired): string;

  create402Response(requirements: PaymentRequired): {
    status: 402;
    headers: { 'PAYMENT-REQUIRED': string };
    body: Record<string, unknown>;
  };

  verifyPayment(signatureHeader: string): Promise<VerifyResponse>;

  settlePayment(signatureHeader: string): Promise<SettleResponse>;
}

// ============================================================================
// Factory
// ============================================================================

export function createInvoiceX402Server(config: InvoiceX402ServerConfig): InvoiceX402Server {
  const {
    tokenOutId: defaultTokenOutId,
    captureMode: defaultCaptureMode = false,
    defaultTimeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    telegramBotAppUrl = DEFAULT_TELEGRAM_BOT_APP_URL,
    walletAddress,
  } = config;

  const client = new InvoiceApiClient(config);

  // In-memory cache: reuse the same payment link for the same (payer, amount, token).
  // Key format: "<payerAddress>::<amount>::<tokenOutId>"
  // Only populated when payerAddress is explicitly provided (not for anonymous links).
  const linkCache = new Map<string, { paymentLinkId: number; expiresAt: number }>();

  function buildCacheKey(payerAddress: string, amount: string, tokenOutId: number): string {
    return `${payerAddress}::${amount}::${tokenOutId}`;
  }

  function buildNetworkString(sig: PaymentLinkSignature, paymentLink: PaymentLink): string {
    const token = paymentLink.tokenOut;
    if (token && token.networkType === NetworkType.TON) {
      return `ton:${token.networkId}`;
    }
    return `eip155:${sig.chainId}`;
  }

  async function buildRequirementsForPayer(
    options: BuildRequirementsForPayerOptions,
    payerAddress?: string,
  ): Promise<PaymentRequired> {
    const {
      amount,
      resourceUrl,
      description,
      timeoutSeconds = defaultTimeoutSeconds,
      tokenOutId = defaultTokenOutId,
      captureMode = defaultCaptureMode,
    } = options;

    const isOneTime = !payerAddress;
    const now = Date.now();

    // Step 1: resolve payment link ID — reuse a cached link when the same
    // payer identity (sessionId / address), amount, and token are seen again.
    const cacheKey = payerAddress
      ? buildCacheKey(payerAddress, String(amount), tokenOutId)
      : null;

    let paymentLinkId: number | undefined;
    if (cacheKey) {
      const cached = linkCache.get(cacheKey);
      if (cached) {
        if (cached.expiresAt > now) {
          paymentLinkId = cached.paymentLinkId;
        } else {
          linkCache.delete(cacheKey);
        }
      }
    }

    if (paymentLinkId === undefined) {
      const paymentLink = await client.createPaymentLink({
        amount,
        tokenOutId,
        captureMode,
        oneTime: isOneTime,
      });
      paymentLinkId = paymentLink.id;
      if (cacheKey) {
        linkCache.set(cacheKey, {
          paymentLinkId,
          expiresAt: now + timeoutSeconds * 1000,
        });
      }
    }

    // Step 2: sign with payer (or wallet address for one-time links)
    const signedLink = await client.signPaymentLink(
      paymentLinkId,
      payerAddress ?? walletAddress,
    );

    const signatures = signedLink.signatures ?? [];

    // Step 3: build one PaymentAccept per signature (per chain)
    const accepts: PaymentAccept[] = signatures.map((sig) => {
      const network = buildNetworkString(sig, signedLink);
      const paymentUrl = `${telegramBotAppUrl}?startapp=i_${signedLink.id}`;

      return {
        scheme: 'exact' as const,
        network,
        maxAmountRequired: String(signedLink.amount),
        asset: sig.tokenAddress,
        payTo: signedLink.recipientAddress,
        maxTimeoutSeconds: timeoutSeconds,
        extra: {
          paymentLinkId: signedLink.id,
          idBytes16: sig.idBytes16,
          paymentUrl,
          contractAddress: sig.contractAddress,
          operatorAddress: sig.operatorAddress,
          signature: sig.signature,
          feeAmount: String(sig.feeAmount),
          refundDestination: sig.refundDestination,
          escrowAddress: sig.escrowAddress ?? undefined,
        },
      };
    });

    const resource: ResourceInfo = {
      url: resourceUrl,
      description,
    };

    return {
      x402Version: 2,
      resource,
      accepts,
      error: 'Payment required',
    };
  }

  function encodeRequirements(requirements: PaymentRequired): string {
    return encodeBase64Json(requirements);
  }

  function create402Response(requirements: PaymentRequired) {
    return {
      status: 402 as const,
      headers: {
        'PAYMENT-REQUIRED': encodeRequirements(requirements),
      },
      body: {},
    };
  }

  async function verifyPayment(signatureHeader: string): Promise<VerifyResponse> {
    let proof: InvoicePaymentProof;
    try {
      proof = decodeBase64Json<InvoicePaymentProof>(signatureHeader);
    } catch {
      return { isValid: false, invalidReason: 'invalid_payment_signature' };
    }

    let payment;
    try {
      payment = await client.getPayment({ paymentLinkId: proof.paymentLinkId });
    } catch (err) {
      // API returns 403 when no payment exists under this account — treat as not found
      return { isValid: false, invalidReason: 'payment_not_found' };
    }

    if (!payment) {
      return { isValid: false, invalidReason: 'payment_not_found' };
    }

    if (
      payment.status !== PaymentStatus.AUTHORIZED &&
      payment.status !== PaymentStatus.CAPTURED
    ) {
      return { isValid: false, invalidReason: 'payment_status_invalid' };
    }

    // Payment confirmed — evict cache so the next request from the same
    // payer identity creates a fresh payment link.
    for (const [key, cached] of linkCache.entries()) {
      if (cached.paymentLinkId === proof.paymentLinkId) {
        linkCache.delete(key);
      }
    }

    return { isValid: true, payer: payment.payerAddress };
  }

  async function settlePayment(signatureHeader: string): Promise<SettleResponse> {
    let proof: InvoicePaymentProof;
    try {
      proof = decodeBase64Json<InvoicePaymentProof>(signatureHeader);
    } catch {
      return {
        success: false,
        network: '',
        errorReason: 'invalid_payment_signature',
      };
    }

    try {
      const response = await client.managePayment({
        idBytes16: proof.idBytes16,
        action: PaymentActions.SETTLE,
        refundAmount: 0,
      });

      return {
        success: true,
        transaction: response.signature,
        network: `eip155:${proof.chainId}`,
        payer: proof.payerAddress,
      };
    } catch (err) {
      return {
        success: false,
        network: `eip155:${proof.chainId}`,
        errorReason: err instanceof Error ? err.message : 'settle_failed',
      };
    }
  }

  return {
    buildRequirementsForPayer,
    encodeRequirements,
    create402Response,
    verifyPayment,
    settlePayment,
  };
}
