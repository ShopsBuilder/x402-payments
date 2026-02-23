/**
 * Integration Test: Invoice x402 Module
 *
 * Tests the full x402 flow against a live multichain-invoice-api at :8000
 *
 * Run: npx tsx test/invoice-integration.ts
 */

import {
  InvoiceApiClient,
  createInvoiceX402Server,
  type InvoiceX402ServerConfig,
} from '../src/invoice/index';
import { decodeBase64Json } from '../src/utils';
import type { PaymentRequired, PaymentAccept } from '../src/types';
import { PaymentStatus } from '../src/invoice/types';

// ─── Config ───────────────────────────────────────────────────────────────────
// Set these via environment variables. Request credentials at:
// https://forms.gle/maN4Fe6PYg7Sg5NRA

const S2S_AUTH_URL   = process.env['S2S_AUTH_URL']   ?? 'https://s2s-development.telegram-shops.com';
const S2S_USERNAME   = process.env['S2S_USERNAME']   ?? '';
const S2S_PASSWORD   = process.env['S2S_PASSWORD']   ?? '';
const INVOICE_API_URL = process.env['INVOICE_API_URL'] ?? 'http://localhost:8000';
// Operator/service wallet (valid TON address used as recipient)
const SERVICE_WALLET = process.env['WALLET_ADDRESS'] ?? '';
const TOKEN_OUT_ID   = Number(process.env['TOKEN_OUT_ID'] ?? 1); // 1 = TON native token

if (!S2S_USERNAME || !S2S_PASSWORD || !SERVICE_WALLET) {
  console.error('Missing required env vars: S2S_USERNAME, S2S_PASSWORD, WALLET_ADDRESS');
  console.error('Request credentials at: https://forms.gle/maN4Fe6PYg7Sg5NRA');
  process.exit(1);
}

const config: InvoiceX402ServerConfig = {
  invoiceApiUrl: INVOICE_API_URL,
  s2sAuthUrl: S2S_AUTH_URL,
  s2sUsername: S2S_USERNAME,
  s2sPassword: S2S_PASSWORD,
  walletAddress: SERVICE_WALLET,
  tokenOutId: TOKEN_OUT_ID,
};

// Unique payer address per session (EVM-style hex, 42 chars)
const SESSION_PAYER = `0x${Date.now().toString(16).padStart(40, '0')}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n[${passed + failed + 1}] ${name}... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    console.log(`❌ FAIL: ${err instanceof Error ? err.message : err}`);
    if (process.env['VERBOSE']) console.error(err);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Invoice x402 SDK — Integration Tests');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  API:         ${INVOICE_API_URL}`);
  console.log(`  S2S:         ${S2S_AUTH_URL}`);
  console.log(`  Wallet:      ${SERVICE_WALLET}`);
  console.log(`  Session payer: ${SESSION_PAYER}`);

  const client = new InvoiceApiClient(config);
  const server = createInvoiceX402Server(config);

  // ── 1. S2S token fetch ────────────────────────────────────────────────────
  await test('S2S auth — fetch token', async () => {
    // execute a trivial query to force token fetch
    const tokens = await client.listTokens();
    assert(tokens.edges.length > 0, 'No tokens returned');
    console.log(`\n     tokens: ${tokens.edges.map(e => `${e.node.symbol}(id=${e.node.id})`).join(', ')}`);
  });

  // ── 2. List tokens ────────────────────────────────────────────────────────
  await test('InvoiceApiClient — listTokens()', async () => {
    const tokens = await client.listTokens();
    assert(tokens.totalCount > 0, 'totalCount is 0');
    const ton = tokens.edges.find(e => e.node.symbol === 'TON');
    assert(!!ton, 'TON token not found');
    assert(ton!.node.networkType === 'TON', `Expected TON networkType, got ${ton!.node.networkType}`);
  });

  // ── 3. Create payment link ────────────────────────────────────────────────
  let paymentLinkId = 0;
  await test('InvoiceApiClient — createPaymentLink()', async () => {
    const pl = await client.createPaymentLink({
      amount: 1_000_000_000, // 1 TON in nanoTON
      tokenOutId: TOKEN_OUT_ID,
      oneTime: false,
    });
    assert(pl.id > 0, `Expected id > 0, got ${pl.id}`);
    assert(pl.amount === 1_000_000_000 || String(pl.amount) === '1000000000', `Wrong amount: ${pl.amount}`);
    assert(pl.recipientAddress === SERVICE_WALLET, `Wrong recipient: ${pl.recipientAddress}`);
    paymentLinkId = pl.id;
    console.log(`\n     id=${pl.id}, recipient=${pl.recipientAddress}`);
  });

  // ── 4. Sign payment link with session payer ───────────────────────────────
  let idBytes16 = '';
  await test('InvoiceApiClient — signPaymentLink() with session payer', async () => {
    assert(paymentLinkId > 0, 'No payment link from previous test');
    const signed = await client.signPaymentLink(paymentLinkId, SESSION_PAYER);
    assert(Array.isArray(signed.signatures) && signed.signatures!.length > 0, 'No signatures returned');
    const sig = signed.signatures![0];
    assert(sig.idBytes16.length === 32, `idBytes16 length wrong: ${sig.idBytes16.length}`);
    assert(sig.signature.length > 0, 'Empty signature');
    assert(sig.chainId === -1, `Expected TON chainId=-1, got ${sig.chainId}`);
    idBytes16 = sig.idBytes16;
    console.log(`\n     chainId=${sig.chainId}, idBytes16=${sig.idBytes16}, escrow=${sig.escrowAddress}`);
  });

  // ── 5. getPaymentLink by id ───────────────────────────────────────────────
  await test('InvoiceApiClient — getPaymentLink()', async () => {
    assert(paymentLinkId > 0, 'No payment link id');
    const pl = await client.getPaymentLink({ id: paymentLinkId });
    assert(!!pl, 'Payment link not found');
    assert(pl!.id === paymentLinkId, `Wrong id: ${pl!.id}`);
  });

  // ── 6. buildRequirementsForPayer — no payer (one-time) ───────────────────
  let oneTimeRequirements: PaymentRequired | null = null;
  await test('createInvoiceX402Server — buildRequirementsForPayer() one-time (no payer)', async () => {
    const req = await server.buildRequirementsForPayer({
      amount: 1_000_000_000,
      resourceUrl: 'http://localhost:3000/api/premium',
      description: 'Integration test one-time link',
    });
    assert(req.x402Version === 2, `Wrong x402Version: ${req.x402Version}`);
    assert(req.accepts.length > 0, 'No accepts');
    const accept = req.accepts[0];
    assert(accept.scheme === 'exact', `Wrong scheme: ${accept.scheme}`);
    assert(accept.extra['paymentUrl'] !== undefined, 'Missing paymentUrl in extra');
    assert(
      String(accept.extra['paymentUrl']).includes('startapp=i_'),
      `paymentUrl missing startapp param: ${accept.extra['paymentUrl']}`,
    );
    assert(accept.extra['idBytes16'] !== undefined, 'Missing idBytes16');
    oneTimeRequirements = req;
    const plId = accept.extra['paymentLinkId'];
    console.log(`\n     paymentLinkId=${plId}, paymentUrl=${accept.extra['paymentUrl']}`);
    console.log(`     network=${accept.network}, asset=${accept.asset}`);
  });

  // ── 7. buildRequirementsForPayer — with specific payer ───────────────────
  let payerRequirements: PaymentRequired | null = null;
  await test('createInvoiceX402Server — buildRequirementsForPayer() with payer', async () => {
    const req = await server.buildRequirementsForPayer(
      {
        amount: 2_000_000_000,
        resourceUrl: 'http://localhost:3000/api/data',
        description: 'Integration test with payer',
      },
      SESSION_PAYER,
    );
    assert(req.x402Version === 2, `Wrong x402Version: ${req.x402Version}`);
    assert(req.accepts.length > 0, 'No accepts');
    const accept = req.accepts[0];
    assert(String(accept.maxAmountRequired) === '2000000000', `Wrong amount: ${accept.maxAmountRequired}`);
    assert(
      String(accept.extra['paymentUrl']).startsWith('t.me/InvoiceGbot/pay'),
      `Wrong base URL: ${accept.extra['paymentUrl']}`,
    );
    payerRequirements = req;
    console.log(`\n     paymentUrl=${accept.extra['paymentUrl']}`);
    console.log(`     network=${accept.network}, feeAmount=${accept.extra['feeAmount']}`);
  });

  // ── 8. encodeRequirements / round-trip ───────────────────────────────────
  await test('createInvoiceX402Server — encodeRequirements() round-trip', async () => {
    assert(!!oneTimeRequirements, 'No requirements from test 6');
    const encoded = server.encodeRequirements(oneTimeRequirements!);
    assert(typeof encoded === 'string' && encoded.length > 0, 'Encoded is empty');
    const decoded = decodeBase64Json<PaymentRequired>(encoded);
    assert(decoded.x402Version === 2, 'Decoded x402Version wrong');
    assert(decoded.accepts.length === oneTimeRequirements!.accepts.length, 'Decoded accepts length mismatch');
    assert(
      decoded.accepts[0].extra['paymentUrl'] === oneTimeRequirements!.accepts[0].extra['paymentUrl'],
      'paymentUrl mismatch after round-trip',
    );
    console.log(`\n     encoded length=${encoded.length}, accepts=${decoded.accepts.length}`);
  });

  // ── 9. create402Response shape ────────────────────────────────────────────
  await test('createInvoiceX402Server — create402Response() shape', async () => {
    assert(!!oneTimeRequirements, 'No requirements from test 6');
    const resp = server.create402Response(oneTimeRequirements!);
    assert(resp.status === 402, `Wrong status: ${resp.status}`);
    assert(typeof resp.headers['PAYMENT-REQUIRED'] === 'string', 'Missing PAYMENT-REQUIRED header');
    assert(Object.keys(resp.body).length === 0, 'body should be empty');
  });

  // ── 10. verifyPayment — invalid base64 ───────────────────────────────────
  await test('createInvoiceX402Server — verifyPayment() invalid header', async () => {
    const result = await server.verifyPayment('not-valid-base64!!!');
    assert(!result.isValid, 'Should be invalid');
    assert(result.invalidReason === 'invalid_payment_signature', `Wrong reason: ${result.invalidReason}`);
  });

  // ── 11. verifyPayment — payment not found (use real link id, no payment made) ──
  await test('createInvoiceX402Server — verifyPayment() payment not found', async () => {
    const { encodeBase64Json } = await import('../src/utils');
    // Use a real payment link id (from test 3) but a payment that was never made
    assert(paymentLinkId > 0, 'No payment link id from test 3');
    const fakeProof = encodeBase64Json({
      x402Version: 2,
      paymentLinkId,
      idBytes16,
      chainId: -1,
      payerAddress: SESSION_PAYER,
      status: PaymentStatus.AUTHORIZED,
    });
    const result = await server.verifyPayment(fakeProof);
    assert(!result.isValid, 'Should be invalid — payment was never submitted on-chain');
    assert(
      result.invalidReason === 'payment_not_found' || result.invalidReason === 'payment_status_invalid',
      `Unexpected reason: ${result.invalidReason}`,
    );
    console.log(`\n     invalidReason=${result.invalidReason}`);
  });

  // ── 12. Network string is correct for TON ────────────────────────────────
  await test('PaymentAccept — network is ton:-1 for TON tokens', async () => {
    assert(!!payerRequirements, 'No requirements from test 7');
    const accept = payerRequirements!.accepts[0] as PaymentAccept;
    assert(accept.network === 'ton:-1', `Expected ton:-1, got ${accept.network}`);
  });

  // ── 13. listPaymentLinks ──────────────────────────────────────────────────
  await test('InvoiceApiClient — listPaymentLinks()', async () => {
    const conn = await client.listPaymentLinks(undefined, { first: 5 });
    assert(conn.edges.length > 0, 'No payment links returned');
    assert(typeof conn.totalCount === 'number', 'Missing totalCount');
    console.log(`\n     totalCount=${conn.totalCount}, returned=${conn.edges.length}`);
  });

  // ── 14. Full 402 flow check ───────────────────────────────────────────────
  await test('Full flow — 402 response → decode → paymentUrl present', async () => {
    const req = await server.buildRequirementsForPayer(
      { amount: 1_000_000_000, resourceUrl: 'http://localhost:3000/api/check' },
      SESSION_PAYER,
    );
    const resp = server.create402Response(req);
    assert(resp.status === 402, 'Wrong status');

    const decoded = decodeBase64Json<PaymentRequired>(resp.headers['PAYMENT-REQUIRED']);
    assert(decoded.x402Version === 2, 'Wrong version after decode');
    assert(decoded.accepts.length > 0, 'No accepts after decode');

    const paymentUrl = String(decoded.accepts[0].extra['paymentUrl']);
    assert(paymentUrl.startsWith('t.me/InvoiceGbot/pay?startapp=i_'), `Wrong paymentUrl: ${paymentUrl}`);

    const linkId = decoded.accepts[0].extra['paymentLinkId'] as number;
    assert(linkId > 0, `Invalid paymentLinkId: ${linkId}`);
    console.log(`\n     Final paymentUrl: ${paymentUrl}`);
    console.log(`     idBytes16: ${decoded.accepts[0].extra['idBytes16']}`);
    console.log(`     escrowAddress: ${decoded.accepts[0].extra['escrowAddress']}`);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
