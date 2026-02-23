/**
 * @shopsbuilder/x402 Invoice Module
 *
 * x402 payment server backed by the multichain-invoice-api.
 * Supports EVM + TON chains via Telegram bot payment flow.
 *
 * @example
 * ```typescript
 * import { createInvoiceX402Server } from '@shopsbuilder/x402/invoice';
 *
 * const server = createInvoiceX402Server({
 *   invoiceApiUrl: 'http://localhost:8000',
 *   s2sAuthUrl: 'http://localhost:8001',
 *   s2sUsername: 'service',
 *   s2sPassword: 'secret',
 *   tokenOutId: 1,
 * });
 *
 * const requirements = await server.buildRequirementsForPayer(
 *   { amount: '1000000', resourceUrl: '/api/premium' },
 *   '0xPayerAddress...',
 * );
 * ```
 */

export { InvoiceApiClient } from './graphql-client';
export { createInvoiceX402Server } from './server';
export type {
  BuildRequirementsForPayerOptions,
  InvoiceX402Server,
} from './server';
export { invoiceX402Middleware } from './middleware';
export type {
  InvoiceX402MiddlewareConfig,
  InvoiceX402Request,
} from './middleware';
export type * from './types';

export const INVOICE_API_DEFAULT_URL = 'http://localhost:8000';
