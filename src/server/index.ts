/**
 * @shopsbuilder/x402/server
 *
 * Server-side helpers for the x402 payment protocol backed by
 * the ShopsBuilder multichain-invoice-api.
 *
 * This module re-exports the invoice module as the primary server API.
 *
 * @example Express (recommended)
 * ```typescript
 * import express from 'express';
 * import { x402Middleware } from '@shopsbuilder/x402/server';
 *
 * const app = express();
 *
 * app.get('/api/premium',
 *   x402Middleware({
 *     invoiceApiUrl: 'http://localhost:8000',
 *     s2sAuthUrl: 'https://s2s.example.com',
 *     s2sUsername: 'user',
 *     s2sPassword: 'pass',
 *     walletAddress: '0QYour...TonAddress',
 *     tokenOutId: 1,
 *     amount: '1000000000',
 *   }),
 *   (req, res) => res.json({ data: 'paid content' }),
 * );
 * ```
 *
 * @example Manual
 * ```typescript
 * import { createInvoiceX402Server } from '@shopsbuilder/x402/server';
 *
 * const server = createInvoiceX402Server({ ...config });
 *
 * const requirements = await server.buildRequirementsForPayer(
 *   { amount: '1000000000', resourceUrl: req.url },
 *   req.headers['x-payer-address'],
 * );
 * res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
 * res.status(402).json({});
 * ```
 */

// Primary API
export { createInvoiceX402Server } from '../invoice/server';
export type {
  InvoiceX402Server,
  BuildRequirementsForPayerOptions,
} from '../invoice/server';

export { x402Middleware } from './middleware';
export { invoiceX402Middleware } from '../invoice/middleware';
export type { X402MiddlewareConfig, X402Request } from './middleware';

// Re-export entire invoice module
export { InvoiceApiClient } from '../invoice/graphql-client';
export type * from '../invoice/types';
export { INVOICE_API_DEFAULT_URL } from '../invoice/index';

// Shared protocol types
export type {
  PaymentRequired,
  PaymentAccept,
  VerifyResponse,
  SettleResponse,
  AcceptsExtra,
  ResourceInfo,
} from '../types';
