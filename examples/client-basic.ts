/**
 * @shopsbuilder/x402 — Client Example
 *
 * Demonstrates the full x402 payment flow when consuming an endpoint
 * protected by the ShopsBuilder invoice API.
 *
 * Run (server must be started first):
 *   npx tsx examples/server-express.ts   # terminal 1
 *   npx tsx examples/client-basic.ts     # terminal 2
 *
 * What this does:
 *  1. Hits /api/premium → gets 402 with PAYMENT-REQUIRED header
 *  2. Decodes the header → extracts Telegram payment URL + idBytes16
 *  3. Prints the Telegram URL for the user to open and pay
 *  4. Waits for ENTER (simulating user paying on Telegram)
 *  5. Builds a PAYMENT-SIGNATURE proof header
 *  6. Retries the request → server verifies on-chain → 200
 */

import * as readline from 'node:readline';
import {
  parse402Response,
  extractPaymentUrl,
  buildPaymentSignatureHeader,
} from '../src/client';

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_URL  = process.env['SERVER_URL']    ?? 'http://localhost:3000';
const PAYER_ADDR  = process.env['PAYER_ADDRESS'] ?? ''; // your TON wallet address
const CHAIN_ID    = -1; // TON mainnet

if (!PAYER_ADDR) {
  console.error('Set PAYER_ADDRESS to your TON wallet address (e.g. 0QYour...Address)');
  process.exit(1);
}
// Optional: an opaque session identifier sent as X-Session-Id.
// When provided, the server reuses the same payment link for all requests
// that carry the same session (until payment is confirmed).
const SESSION_ID  = process.env['SESSION_ID']; // e.g. "user-42" or a UUID

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n@shopsbuilder/x402 — Client Example');
  console.log('═'.repeat(40));
  console.log(`Server    : ${SERVER_URL}`);
  console.log(`Payer     : ${PAYER_ADDR}`);
  if (SESSION_ID) console.log(`Session   : ${SESSION_ID}`);
  console.log();

  // Build common request headers (session identity propagated to every call)
  const baseHeaders: Record<string, string> = {};
  if (SESSION_ID) baseHeaders['X-Session-Id'] = SESSION_ID;

  // ── Step 1: Hit the protected endpoint ─────────────────────────────────────
  console.log('[1] GET /api/premium ...');
  const firstRes = await fetch(
    `${SERVER_URL}/api/premium?payerAddress=${encodeURIComponent(PAYER_ADDR)}`,
    { headers: baseHeaders },
  );

  if (firstRes.status !== 402) {
    console.log(`Unexpected status ${firstRes.status}. Already paid? Response:`);
    console.log(await firstRes.json());
    return;
  }
  console.log(`    → 402 Payment Required`);

  // ── Step 2: Decode PAYMENT-REQUIRED header ──────────────────────────────────
  const requirements = parse402Response(firstRes.headers);
  const accept = requirements.accepts[0];

  if (!accept) throw new Error('No payment option in 402 response');

  const paymentUrl = extractPaymentUrl(requirements);
  const paymentLinkId = accept.extra['paymentLinkId'] as number;
  const idBytes16     = accept.extra['idBytes16'] as string;

  console.log('\n[2] Payment details:');
  console.log(`    paymentLinkId : ${paymentLinkId}`);
  console.log(`    idBytes16     : ${idBytes16}`);
  console.log(`    network       : ${accept.network}`);
  console.log(`    amount        : ${accept.maxAmountRequired} nanoTON`);
  console.log(`    escrow        : ${accept.extra['escrowAddress']}`);
  console.log(`\n    Telegram URL  : ${paymentUrl}`);

  // ── Step 3: User pays on Telegram ───────────────────────────────────────────
  console.log('\n[3] Open the Telegram URL above and complete the payment.');
  console.log('    (In a real app, your Telegram bot sends a webhook when paid.)');
  await prompt('\n    Press ENTER when payment is complete... ');

  // ── Step 4: Build PAYMENT-SIGNATURE header ──────────────────────────────────
  const signatureHeader = buildPaymentSignatureHeader({
    paymentLinkId,
    idBytes16,
    chainId:      CHAIN_ID,
    payerAddress: PAYER_ADDR,
    status:       'AUTHORIZED',
  });

  console.log('\n[4] Retrying with PAYMENT-SIGNATURE header...');

  // ── Step 5: Retry the request ───────────────────────────────────────────────
  const paidRes = await fetch(
    `${SERVER_URL}/api/premium?payerAddress=${encodeURIComponent(PAYER_ADDR)}`,
    { headers: { ...baseHeaders, 'payment-signature': signatureHeader } },
  );

  console.log(`    → ${paidRes.status} ${paidRes.statusText}`);

  const body = await paidRes.json();
  console.log('\n[5] Response:');
  console.log(JSON.stringify(body, null, 2));

  if (paidRes.ok) {
    console.log('\n✅ Access granted!\n');
  } else {
    console.log('\n❌ Payment not accepted yet. Reason:', body.reason ?? body.error);
    console.log('   Make sure the payment was completed on Telegram.\n');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
