/**
 * @shopsbuilder/x402 — Express Server Example
 *
 * Demonstrates how to protect API endpoints with x402 payments backed by the
 * ShopsBuilder multichain-invoice-api.  Users pay via a Telegram bot and the
 * server verifies on-chain before granting access.
 *
 * Run:
 *   npx tsx examples/server-express.ts
 *
 * Quick test (returns 402):
 *   curl -i http://localhost:3000/api/premium
 *
 * With optional payer address in query-string (shows personalized Telegram URL):
 *   curl -i "http://localhost:3000/api/premium?payerAddress=0QYour...TonAddr"
 *
 * After user pays in Telegram, retry with proof:
 *   curl -i http://localhost:3000/api/premium \
 *     -H "PAYMENT-SIGNATURE: <base64-proof>"
 */

import express from 'express';
import {
  createInvoiceX402Server,
  invoiceX402Middleware,
  InvoiceApiClient,
} from '../src/invoice';
import type { InvoiceX402ServerConfig } from '../src/invoice';
import { decodeBase64Json } from '../src/utils';
import type { PaymentRequired } from '../src/types';

// ─── Config ───────────────────────────────────────────────────────────────────
// All values must be supplied via environment variables.
// Request access credentials at: https://forms.gle/maN4Fe6PYg7Sg5NRA

const PORT = Number(process.env['PORT'] ?? 3000);

const s2sUsername  = process.env['S2S_USERNAME']  ?? '';
const s2sPassword  = process.env['S2S_PASSWORD']  ?? '';
const walletAddress = process.env['WALLET_ADDRESS'] ?? '';

if (!s2sUsername || !s2sPassword || !walletAddress) {
  console.error('Missing required env vars: S2S_USERNAME, S2S_PASSWORD, WALLET_ADDRESS');
  console.error('Request credentials at: https://forms.gle/maN4Fe6PYg7Sg5NRA');
  process.exit(1);
}

const config: InvoiceX402ServerConfig = {
  invoiceApiUrl:  process.env['INVOICE_API_URL']  ?? 'https://invoice-generator-development.telegram-shops.com',
  s2sAuthUrl:     process.env['S2S_AUTH_URL']     ?? 'https://s2s-development.telegram-shops.com',
  s2sUsername,
  s2sPassword,
  walletAddress,
  tokenOutId:     Number(process.env['TOKEN_OUT_ID'] ?? 1), // 1 = TON native
  captureMode:    false,
  defaultTimeoutSeconds: 300,
  telegramBotAppUrl: 't.me/InvoiceTbot/pay',
};

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Free health check ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Premium endpoint — one-liner middleware ───────────────────────────────────
// Payer address is read from ?payerAddress= query param or X-Payer-Address header.
// When omitted a one-time anonymous payment link is generated.
app.get(
  '/api/premium',
  invoiceX402Middleware({
    ...config,
    amount: '1000000000',          // 1 TON in nanoTON
    description: 'Premium content access',
    autoSettle: false,             // settle separately if needed
    verbose: true,
  }),
  (req, res) => {
    const info = (req as express.Request & { invoiceX402?: { paymentLinkId: number; payerAddress: string } }).invoiceX402;
    res.json({
      message: 'Welcome! Payment verified.',
      paymentLinkId: info?.paymentLinkId,
      payer: info?.payerAddress,
      data: { secret: 'Premium content for verified payers only.' },
    });
  },
);

// ── Manual flow — full control over 402 / verify / settle ────────────────────
const server = createInvoiceX402Server(config);

app.post('/api/data', async (req, res) => {
  const sig = req.headers['payment-signature'] as string | undefined;

  if (!sig) {
    // Extract optional payer identity from request.
    // Accepts an explicit wallet address or any opaque sessionId string —
    // both are treated as payer identity for payment-link caching.
    const payerAddress =
      (req.query['payerAddress'] as string | undefined) ||
      (req.headers['x-payer-address'] as string | undefined) ||
      (req.query['sessionId'] as string | undefined) ||
      (req.headers['x-session-id'] as string | undefined);

    const requirements = await server.buildRequirementsForPayer(
      {
        amount: '2000000000',       // 2 TON
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        description: 'Data API access',
      },
      payerAddress,
    );

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    return res.status(402).json({
      error: 'Payment required',
      paymentUrl: requirements.accepts[0]?.extra['paymentUrl'],
      accepts: requirements.accepts,
    });
  }

  const verify = await server.verifyPayment(sig);
  if (!verify.isValid) {
    return res.status(402).json({ error: 'Payment not valid', reason: verify.invalidReason });
  }

  // Optionally settle (moves funds from escrow to recipient)
  const settle = await server.settlePayment(sig);

  return res.json({
    message: 'Data delivered.',
    settled: settle.success,
    tx: settle.transaction,
    payer: verify.payer,
  });
});

// ── Debug: inspect a PAYMENT-REQUIRED header ────────────────────────────────
app.get('/debug/decode', (req, res) => {
  const encoded = req.query['h'] as string;
  if (!encoded) return res.status(400).json({ error: 'Pass ?h=<base64>' });
  try {
    const decoded = decodeBase64Json<PaymentRequired>(encoded);
    return res.json(decoded);
  } catch {
    return res.status(400).json({ error: 'Invalid base64' });
  }
});

// ── List all configured tokens ───────────────────────────────────────────────
app.get('/debug/tokens', async (_req, res) => {
  const client = new InvoiceApiClient(config);
  const tokens = await client.listTokens();
  res.json(tokens);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n@shopsbuilder/x402 — Express Server Example');
  console.log('═'.repeat(48));
  console.log(`Invoice API : ${config.invoiceApiUrl}`);
  console.log(`Wallet      : ${config.walletAddress}`);
  console.log(`Server      : http://localhost:${PORT}\n`);
  console.log('Endpoints:');
  console.log('  GET  /api/health         free');
  console.log('  GET  /api/premium        1 TON  (middleware)');
  console.log('  POST /api/data           2 TON  (manual flow)');
  console.log('  GET  /debug/tokens       list tokens');
  console.log('  GET  /debug/decode?h=    decode a PAYMENT-REQUIRED header\n');
  console.log('Quick test:');
  console.log(`  curl -i http://localhost:${PORT}/api/premium`);
  console.log(`  curl -i http://localhost:${PORT}/api/health`);
  console.log(`  curl -i http://localhost:${PORT}/api/premium -H "X-Session-Id: alice"`);
  console.log(`  curl -i "http://localhost:${PORT}/api/premium?sessionId=alice"\n`);
  console.log('Session note:');
  console.log('  Pass X-Session-Id header or ?sessionId= query param to reuse the');
  console.log('  same payment link across requests (until the payment is confirmed).\n');
});
