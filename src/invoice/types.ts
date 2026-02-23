/**
 * Invoice API Types
 *
 * TypeScript types derived from the multichain-invoice-api GraphQL schema.
 */

// ============================================================================
// Enums
// ============================================================================

export enum Currency {
  TON = 'TON',
  USDT = 'USDT',
  USDC = 'USDC',
  ETH = 'ETH',
}

export enum NetworkType {
  EVM = 'EVM',
  TON = 'TON',
}

export enum PaymentStatus {
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  REFUNDED = 'REFUNDED',
  CANCELED = 'CANCELED',
  SETTLED = 'SETTLED',
}

export enum PaymentActions {
  PAY = 'PAY',
  REFUND = 'REFUND',
  CANCEL = 'CANCEL',
  SETTLE = 'SETTLE',
}

export enum OrderBy {
  ASC = 'ASC',
  DESC = 'DESC',
}

// ============================================================================
// Object Types
// ============================================================================

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}

export interface Account {
  id: number;
  walletAddress?: string | null;
  tgId?: number | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  invitedById?: number | null;
}

export interface Token {
  id: number;
  symbol: string;
  networkId: number;
  networkType: NetworkType;
  tokenAddress: string;
  decimals: string | number;
  minimumAmount: string | number;
}

export interface PaymentLinkSignature {
  chainId: number;
  contractAddress: string;
  signature: string;
  idBytes16: string;
  operatorAddress: string;
  feeAmount: string | number;
  refundDestination: string;
  tokenAddress: string;
  escrowAddress?: string | null;
  tokenAddressReference?: string | null;
}

export interface PaymentLink {
  id: number;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  amount: string | number;
  recipientAddress: string;
  currency: Currency;
  deadline?: string | null;
  accountId: number;
  tokenOutId: number;
  acceptAnyToken: boolean;
  acceptDonation: boolean;
  captureMode: boolean;
  oneTime: boolean;
  immutable: boolean;
  authorizationExpirySeconds: number;
  externalWebhook?: string | null;
  createdAt: string;
  updatedAt: string;
  signatures?: PaymentLinkSignature[] | null;
  paymentStatus?: PaymentStatus | null;
  isPaid: boolean;
  account?: Account | null;
  tokenOut?: Token | null;
}

export interface Payment {
  id: number;
  idBytes16: string;
  paymentLinkId: number;
  status: PaymentStatus;
  accountId: number;
  payerAddress: string;
  amount: string | number;
  chainId: number;
  contractAddress: string;
  operatorAddress: string;
  feeAmount: string | number;
  tokenId: number;
  createdAt: string;
  updatedAt: string;
  paymentLink?: PaymentLink | null;
  account?: Account | null;
  tokenOut?: Token | null;
}

export interface PaymentActionSignatureResponse {
  signature: string;
  escrowAddress: string;
  operatorAddress: string;
  nonce: number;
  refundAmount: number;
}

// ============================================================================
// Connection Types
// ============================================================================

export interface PaymentLinkEdge {
  node: PaymentLink;
  cursor: string;
}

export interface PaymentLinkConnection {
  edges: PaymentLinkEdge[];
  pageInfo: PageInfo;
  totalCount: number;
}

export interface PaymentEdge {
  node: Payment;
  cursor: string;
}

export interface PaymentConnection {
  edges: PaymentEdge[];
  pageInfo: PageInfo;
  totalCount: number;
}

export interface TokenEdge {
  node: Token;
  cursor: string;
}

export interface TokenConnection {
  edges: TokenEdge[];
  pageInfo: PageInfo;
  totalCount: number;
}

// ============================================================================
// Input Types
// ============================================================================

export interface OrderByInput {
  field: string;
  direction: OrderBy;
}

export interface PaymentLinkCreateInput {
  amount: string | number;
  recipientAddress?: string | null;
  tokenOutId: number;
  deadline?: string | null;
  captureMode?: boolean | null;
  authorizationExpirySeconds?: number | null;
  oneTime?: boolean;
  immutable?: boolean;
  externalWebhook?: string | null;
}

export interface PaymentLinkUpdateInput {
  amount?: string | number | null;
  recipientAddress?: string | null;
  tokenOutId?: number | null;
  deadline?: string | null;
  captureMode?: boolean | null;
  authorizationExpirySeconds?: number | null;
  externalWebhook?: string | null;
}

export interface PaymentLinkSignedInput {
  payerAddress: string;
}

export interface PaymentLinkFilter {
  id?: number | null;
  recipientAddress?: string | null;
  accountId?: number | null;
  accountWalletAddress?: string | null;
}

export interface PaymentVerifyInput {
  idBytes16: string;
  paymentLinkId: number;
  payerAddress: string;
  chainId: number;
  verifyAt?: string | null;
  status: PaymentStatus;
}

export interface PaymentManageInput {
  idBytes16: string;
  action: PaymentActions;
  refundAmount?: number;
}

export interface PaymentFilter {
  id?: number | null;
  paymentLinkId?: number | null;
  status?: PaymentStatus[] | null;
  accountId?: number | null;
  payerAddress?: string | null;
  chainId?: number | null;
  tokenId?: number | null;
  accountWalletAddress?: string | null;
  payerOrAccountWalletAddress?: string | null;
}

export interface TokenFilter {
  id?: number | null;
  symbol?: string | null;
  networkId?: number | null;
  networkType?: NetworkType | null;
}

export interface PaginationInput {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
  orderBy?: OrderByInput[] | null;
}

// ============================================================================
// SDK-specific Types
// ============================================================================

export interface InvoiceApiClientConfig {
  /** Invoice API base URL, e.g. 'http://localhost:8000' */
  invoiceApiUrl: string;
  /** OAuth2 base URL for S2S token endpoint */
  s2sAuthUrl: string;
  s2sUsername: string;
  s2sPassword: string;
  /** OAuth2 tenant, default 'shops' */
  s2sTenant?: string;
  /**
   * Wallet address sent as X-Wallet-Address header.
   * Used to identify / auto-create the service account.
   * Must be a valid address for the target network
   * (TON user-friendly format when using TON tokens).
   */
  walletAddress: string;
}

export interface InvoiceX402ServerConfig extends InvoiceApiClientConfig {
  /** Default token ID for created payment links */
  tokenOutId: number;
  /** Enable capture mode (default false) */
  captureMode?: boolean;
  /** Default payment timeout in seconds (default 300) */
  defaultTimeoutSeconds?: number;
  /** Telegram bot app base URL (default 't.me/InvoiceGbot/pay') */
  telegramBotAppUrl?: string;
}

/** Sent by client in PAYMENT-SIGNATURE header (base64 JSON) */
export interface InvoicePaymentProof {
  x402Version: 2;
  paymentLinkId: number;
  idBytes16: string;
  chainId: number;
  payerAddress: string;
  status: PaymentStatus;
}
