<p align="center">
  <img src="./assets/shopsbuilder-logo.svg" alt="ShopsBuilder" width="300">
</p>

<h1 align="center">@shopsbuilder/x402</h1>

<p align="center">
  <strong>x402 payment gating for TON / Telegram — backed by the ShopsBuilder invoice API.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@shopsbuilder/x402"><img src="https://img.shields.io/npm/v/@shopsbuilder/x402.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E=18-brightgreen.svg" alt="Node"></a>
</p>

---

## What is x402?

x402 is a protocol for HTTP-native payments. When a server returns HTTP status `402 Payment Required` it includes payment details in a `PAYMENT-REQUIRED` header. The client pays via Telegram and retries the request with a `PAYMENT-SIGNATURE` header. The server verifies the payment and returns the protected content.

This SDK wires the entire flow to the **ShopsBuilder multichain-invoice-api**: payment links are created on-demand, signed per-payer, and verified against the API before access is granted.

---

## Getting Access

To use this SDK you need **S2S (service-to-service) credentials** and a **TON wallet address** registered with the ShopsBuilder platform.

**[Request access →](https://forms.gle/maN4Fe6PYg7Sg5NRA)**

Once approved you will receive:
- `S2S_USERNAME` and `S2S_PASSWORD` — used to obtain bearer tokens from the S2S auth service
- Your service `WALLET_ADDRESS` — the TON address that receives payments

---

## Install

```bash
npm install @shopsbuilder/x402
# or
pnpm add @shopsbuilder/x402
```

---

## Quick Start

### Server — Express middleware (one-liner)

```typescript
import express from 'express';
import { invoiceX402Middleware } from '@shopsbuilder/x402/invoice';

const app = express();
app.use(express.json());

app.get(
  '/api/premium',
  invoiceX402Middleware({
    invoiceApiUrl: process.env.INVOICE_API_URL ?? 'http://localhost:8000',
    s2sAuthUrl:    process.env.S2S_AUTH_URL    ?? 'https://s2s-development.telegram-shops.com',
    s2sUsername:   process.env.S2S_USERNAME!,
    s2sPassword:   process.env.S2S_PASSWORD!,
    walletAddress: process.env.WALLET_ADDRESS!,
    tokenOutId:    1,            // 1 = TON native
    amount:        '1000000000', // 1 TON in nanoTON
    description:   'Premium content access',
    verbose:       true,
  }),
  (req, res) => {
    res.json({ message: 'Payment verified.', data: 'Premium content.' });
  },
);

app.listen(3000);
```

A `GET /api/premium` without a valid payment signature returns:

```http
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64-encoded-requirements>

{
  "error": "Payment required",
  "accepts": [{ "paymentUrl": "t.me/InvoiceTbot/pay?startapp=i_123", ... }]
}
```

The client opens the Telegram URL, pays, then retries with:

```http
GET /api/premium
payment-signature: <base64-encoded-proof>
```

---

### Session identity — reuse the same payment link

By default every unauthenticated request creates a new payment link. Pass a **session identity** to make repeated requests from the same user share the same link until it is paid:

```bash
# via query param
curl "http://localhost:3000/api/premium?sessionId=user-42"

# via header
curl http://localhost:3000/api/premium -H "X-Session-Id: user-42"

# via explicit TON wallet address
curl "http://localhost:3000/api/premium?payerAddress=0QYour...Address"
```

The server-side cache (keyed on `payerAddress/sessionId + amount + token`) ensures only one payment link is created per session. Once payment is confirmed the cache is evicted and a fresh link is issued on the next request.

---

### Client — consume a protected endpoint

```typescript
import {
  parse402Response,
  extractPaymentUrl,
  buildPaymentSignatureHeader,
} from '@shopsbuilder/x402/client';

// Step 1: hit the protected endpoint
const res = await fetch('http://localhost:3000/api/premium', {
  headers: { 'X-Session-Id': 'user-42' },
});

if (res.status === 402) {
  // Step 2: decode payment requirements
  const requirements = parse402Response(res.headers);
  const accept       = requirements.accepts[0];
  const paymentUrl   = extractPaymentUrl(requirements);
  const { paymentLinkId, idBytes16 } = accept.extra;

  console.log('Pay here:', paymentUrl); // t.me/InvoiceTbot/pay?startapp=i_...

  // Step 3: user pays in Telegram, then build proof
  const sig = buildPaymentSignatureHeader({
    paymentLinkId: paymentLinkId as number,
    idBytes16:     idBytes16 as string,
    chainId:       -1,            // TON mainnet
    payerAddress:  '0QYour...TonAddress',
    status:        'AUTHORIZED',
  });

  // Step 4: retry with payment proof
  const paid = await fetch('http://localhost:3000/api/premium', {
    headers: {
      'X-Session-Id':      'user-42',
      'payment-signature': sig,
    },
  });
  // → 200 OK
}
```

---

## Manual Server (advanced)

For full control over the 402 / verify / settle flow:

```typescript
import { createInvoiceX402Server } from '@shopsbuilder/x402/invoice';

const server = createInvoiceX402Server({
  invoiceApiUrl: 'http://localhost:8000',
  s2sAuthUrl:    'https://s2s-development.telegram-shops.com',
  s2sUsername:   process.env.S2S_USERNAME!,
  s2sPassword:   process.env.S2S_PASSWORD!,
  walletAddress: process.env.WALLET_ADDRESS!,
  tokenOutId:    1,
});

app.get('/api/data', async (req, res) => {
  const sig = req.headers['payment-signature'] as string | undefined;

  if (!sig) {
    const payerAddress =
      (req.query.payerAddress as string | undefined) ||
      (req.headers['x-session-id'] as string | undefined);

    const requirements = await server.buildRequirementsForPayer(
      { amount: '1000000000', resourceUrl: req.originalUrl },
      payerAddress,
    );

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    return res.status(402).json({
      error:      'Payment required',
      paymentUrl: requirements.accepts[0]?.extra['paymentUrl'],
    });
  }

  const verify = await server.verifyPayment(sig);
  if (!verify.isValid) {
    return res.status(402).json({ error: verify.invalidReason });
  }

  res.json({ message: 'Access granted.', payer: verify.payer });
});
```

---

## Package Exports

```typescript
// Invoice server — main API
import {
  createInvoiceX402Server,
  invoiceX402Middleware,
  InvoiceApiClient,
} from '@shopsbuilder/x402/invoice';

// Client helpers (parse 402, build signature header)
import {
  parse402Response,
  extractPaymentUrl,
  buildPaymentSignatureHeader,
} from '@shopsbuilder/x402/client';

// Utilities
import {
  encodeBase64Json,
  decodeBase64Json,
  toAtomicUnits,
  fromAtomicUnits,
} from '@shopsbuilder/x402/utils';
```

---

## API Reference

### `createInvoiceX402Server(config)`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `invoiceApiUrl` | `string` | Yes | Invoice API base URL |
| `s2sAuthUrl` | `string` | Yes | S2S OAuth2 base URL |
| `s2sUsername` | `string` | Yes | S2S service username |
| `s2sPassword` | `string` | Yes | S2S service password |
| `walletAddress` | `string` | Yes | TON address receiving payments |
| `tokenOutId` | `number` | Yes | Token ID (`1` = TON native) |
| `captureMode` | `boolean` | No | Enable capture mode (default `false`) |
| `defaultTimeoutSeconds` | `number` | No | Payment deadline in seconds (default `300`) |
| `telegramBotAppUrl` | `string` | No | Telegram mini-app base URL |

Returns an `InvoiceX402Server` with:

| Method | Description |
|--------|-------------|
| `buildRequirementsForPayer(options, payerAddress?)` | Create / reuse a payment link and return x402 requirements |
| `encodeRequirements(req)` | Base64-encode requirements for the `PAYMENT-REQUIRED` header |
| `create402Response(req)` | Build the full 402 response object `{ status, headers, body }` |
| `verifyPayment(header)` | Verify a `PAYMENT-SIGNATURE` header against the API |
| `settlePayment(header)` | Trigger settlement of a verified payment |

### `invoiceX402Middleware(config)`

All `createInvoiceX402Server` fields plus:

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `string` | Payment amount in atomic units |
| `description` | `string` | Human-readable description |
| `autoSettle` | `boolean` | Settle automatically after verify (default `false`) |
| `verbose` | `boolean` | Enable debug logging |
| `getAmount(req)` | `(req) => string` | Dynamic amount per request |
| `getPayerAddress(req)` | `(req) => string \| undefined` | Custom payer identity resolver |

Payer identity resolution order (highest to lowest priority):
1. `getPayerAddress(req)` callback
2. `?payerAddress=` query param
3. `X-Payer-Address` header
4. `?sessionId=` query param
5. `X-Session-Id` header

### `InvoiceApiClient`

A typed GraphQL client for the invoice API. Useful for querying tokens, payment links, and payments directly.

```typescript
const client = new InvoiceApiClient(config);

const tokens  = await client.listTokens();
const link    = await client.createPaymentLink({ amount: 1_000_000_000, tokenOutId: 1 });
const signed  = await client.signPaymentLink(link.id, payerAddress);
const payment = await client.getPayment({ paymentLinkId: link.id });
```

---

## Running the Examples

```bash
# 1. Install dependencies (including express for the server example)
git clone git@github.com:ShopsBuilder/x402-payments.git
npm install express

# 2. Set credentials (request at https://forms.gle/maN4Fe6PYg7Sg5NRA)
export S2S_USERNAME=your_username
export S2S_PASSWORD=your_password
export WALLET_ADDRESS=0QYour...TonAddress

# 3. Start the example server (terminal 1)
npx tsx examples/server-express.ts

# 4. Run the client example (terminal 2)
export PAYER_ADDRESS=0QYour...TonAddress
export SESSION_ID=my-session-1
npx tsx examples/client-basic.ts
```

Quick tests once the server is running:

```bash
# Returns 402 with Telegram payment URL
curl -i http://localhost:3000/api/premium

# Same session → same payment link every time (until paid)
curl -i http://localhost:3000/api/premium -H "X-Session-Id: alice"
curl -i http://localhost:3000/api/premium -H "X-Session-Id: alice"

# List available tokens
curl http://localhost:3000/debug/tokens
```

---

## Running Tests

The integration test suite requires the invoice API running locally at `http://localhost:8000`.

```bash
# Set credentials (request at https://forms.gle/maN4Fe6PYg7Sg5NRA)
export S2S_USERNAME=your_username
export S2S_PASSWORD=your_password
export WALLET_ADDRESS=0QYour...TonAddress

npm test
# or
npx tsx test/invoice-integration.ts
```

---

## Development

```bash
npm run build      # Build ESM + CJS into dist/
npm run dev        # Watch mode
npm run typecheck  # TypeScript type check
```

---

## License

MIT — see [LICENSE](./LICENSE)
