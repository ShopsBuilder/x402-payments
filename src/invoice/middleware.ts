/**
 * Invoice x402 Express Middleware
 *
 * Protects Express routes with x402 payments backed by the multichain-invoice-api.
 * Redirects payers to a Telegram bot for payment completion.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { encodeBase64Json } from '../utils';
import { createInvoiceX402Server } from './server';
import type { InvoiceX402ServerConfig, InvoicePaymentProof } from './types';
import { decodeBase64Json } from '../utils';

// ============================================================================
// Types
// ============================================================================

export interface InvoiceX402MiddlewareConfig extends InvoiceX402ServerConfig {
  /** Default payment amount in atomic units (e.g., '1000000' for 1 USDC) */
  amount: string;
  /** Human-readable description shown to payers */
  description?: string;
  /** Whether to auto-settle after successful verification (default false) */
  autoSettle?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;

  /** Dynamic amount per request */
  getAmount?: (req: Request) => string;
  /** Dynamic description per request */
  getDescription?: (req: Request) => string;
  /** Dynamic payer address per request */
  getPayerAddress?: (req: Request) => string | undefined;
  /** Dynamic resource URL per request */
  getResourceUrl?: (req: Request) => string;
}

export interface InvoiceX402Request extends Request {
  invoiceX402?: {
    paymentLinkId: number;
    payerAddress: string;
    network: string;
  };
}

// ============================================================================
// Middleware factory
// ============================================================================

export function invoiceX402Middleware(config: InvoiceX402MiddlewareConfig): RequestHandler {
  const {
    amount: staticAmount,
    description: staticDescription,
    autoSettle = false,
    verbose = false,
    getAmount,
    getDescription,
    getPayerAddress,
    getResourceUrl,
  } = config;

  const log = verbose
    ? console.log.bind(console, '[invoice-x402:middleware]')
    : () => {};

  const server = createInvoiceX402Server(config);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signatureHeader = req.headers['payment-signature'] as string | undefined;

      if (!signatureHeader) {
        log('No payment signature, building 402 response');

        // Resolve dynamic values
        // Priority: explicit callback > payerAddress param/header > sessionId param/header
        // A sessionId is used as the payer identity so the same session always
        // receives the same payment link (via the server-side cache).
        const payerAddress =
          getPayerAddress?.(req) ??
          (req.query['payerAddress'] as string | undefined) ??
          (req.headers['x-payer-address'] as string | undefined) ??
          (req.query['sessionId'] as string | undefined) ??
          (req.headers['x-session-id'] as string | undefined);

        const amount = getAmount?.(req) ?? staticAmount;
        const description = getDescription?.(req) ?? staticDescription;
        const resourceUrl =
          getResourceUrl?.(req) ??
          `${req.protocol}://${req.get('host')}${req.originalUrl}`;

        const requirements = await server.buildRequirementsForPayer(
          { amount, description, resourceUrl },
          payerAddress,
        );

        const encoded = server.encodeRequirements(requirements);
        res.setHeader('PAYMENT-REQUIRED', encoded);
        res.status(402).json({
          error: 'Payment required',
          accepts: requirements.accepts,
          resource: requirements.resource,
        });
        return;
      }

      log('Payment signature received, verifying...');

      const verifyResult = await server.verifyPayment(signatureHeader);

      if (!verifyResult.isValid) {
        log('Payment verification failed:', verifyResult.invalidReason);
        res.status(402).json({
          error: 'Payment verification failed',
          reason: verifyResult.invalidReason,
        });
        return;
      }

      log('Payment verified, payer:', verifyResult.payer);

      // Decode proof to get paymentLinkId / chainId for metadata
      let proof: InvoicePaymentProof | null = null;
      try {
        proof = decodeBase64Json<InvoicePaymentProof>(signatureHeader);
      } catch {
        // Non-fatal: attach what we can
      }

      let network = '';

      if (autoSettle) {
        log('Auto-settling payment...');
        const settleResult = await server.settlePayment(signatureHeader);
        if (!settleResult.success) {
          log('Settlement failed:', settleResult.errorReason);
          res.status(402).json({
            error: 'Payment settlement failed',
            reason: settleResult.errorReason,
          });
          return;
        }
        network = settleResult.network;
        log('Payment settled:', settleResult.transaction);

        const paymentResponseData = {
          success: true,
          transaction: settleResult.transaction,
          network,
          payer: verifyResult.payer ?? '',
        };
        res.setHeader('PAYMENT-RESPONSE', encodeBase64Json(paymentResponseData));
      }

      // Attach invoice payment info to request
      (req as InvoiceX402Request).invoiceX402 = {
        paymentLinkId: proof?.paymentLinkId ?? 0,
        payerAddress: verifyResult.payer ?? proof?.payerAddress ?? '',
        network: network || (proof ? `eip155:${proof.chainId}` : ''),
      };

      next();
    } catch (error) {
      log('Middleware error:', error);
      res.status(500).json({
        error: 'Payment processing error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
