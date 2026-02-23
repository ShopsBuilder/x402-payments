/**
 * Invoice API GraphQL Client
 *
 * Typed GraphQL client for the multichain-invoice-api backed by native fetch.
 * Uses S2S token auth mirroring Python's HttpxS2SAuth pattern.
 */

import type {
  InvoiceApiClientConfig,
  PaymentLink,
  PaymentLinkCreateInput,
  PaymentLinkUpdateInput,
  PaymentLinkFilter,
  PaymentLinkConnection,
  Payment,
  PaymentVerifyInput,
  PaymentManageInput,
  PaymentFilter,
  PaymentConnection,
  PaymentActionSignatureResponse,
  Token,
  TokenFilter,
  TokenConnection,
  PaginationInput,
} from './types';

// ============================================================================
// S2S Auth Client
// ============================================================================

interface TokenResponse {
  id_token: string;
  expires_in: number;
  token_type: string;
  access_token?: string;
}

class S2SAuthClient {
  private readonly authUrl: string;
  private readonly username: string;
  private readonly password: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(authUrl: string, username: string, password: string) {
    this.authUrl = authUrl;
    this.username = username;
    this.password = password;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    // Refresh 30 seconds before expiry
    if (this.cachedToken && now < this.tokenExpiresAt - 30_000) {
      return this.cachedToken;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.username,
      password: this.password,
    });

    const response = await fetch(`${this.authUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`S2S token fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.cachedToken = data.id_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;
    return this.cachedToken;
  }
}

// ============================================================================
// GraphQL helpers
// ============================================================================

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

// ============================================================================
// GraphQL fragments and queries
// ============================================================================

const PAGE_INFO_FRAGMENT = `
  pageInfo {
    hasNextPage
    hasPreviousPage
    startCursor
    endCursor
  }
`;

const PAYMENT_LINK_FIELDS = `
  id
  name
  description
  amount
  recipientAddress
  currency
  deadline
  accountId
  tokenOutId
  acceptAnyToken
  acceptDonation
  captureMode
  oneTime
  immutable
  authorizationExpirySeconds
  externalWebhook
  createdAt
  updatedAt
  isPaid
  paymentStatus
  signatures {
    chainId
    contractAddress
    signature
    idBytes16
    operatorAddress
    feeAmount
    refundDestination
    tokenAddress
    escrowAddress
    tokenAddressReference
  }
  tokenOut {
    id
    symbol
    networkId
    networkType
    tokenAddress
    decimals
    minimumAmount
  }
`;

const PAYMENT_FIELDS = `
  id
  idBytes16
  paymentLinkId
  status
  accountId
  payerAddress
  amount
  chainId
  contractAddress
  operatorAddress
  feeAmount
  tokenId
  createdAt
  updatedAt
`;

const TOKEN_FIELDS = `
  id
  symbol
  networkId
  networkType
  tokenAddress
  decimals
  minimumAmount
`;

// ============================================================================
// InvoiceApiClient
// ============================================================================

export class InvoiceApiClient {
  private readonly apiUrl: string;
  private readonly walletAddress: string;
  private readonly auth: S2SAuthClient;

  constructor(config: InvoiceApiClientConfig) {
    this.apiUrl = config.invoiceApiUrl.replace(/\/$/, '');
    this.walletAddress = config.walletAddress;
    this.auth = new S2SAuthClient(
      config.s2sAuthUrl,
      config.s2sUsername,
      config.s2sPassword,
    );
  }

  async execute<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.auth.getToken();

    const response = await fetch(`${this.apiUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': `Bearer ${token}`,
        'X-Wallet-Address': this.walletAddress,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    if (!result.data) {
      throw new Error('GraphQL response missing data');
    }

    return result.data;
  }

  // --------------------------------------------------------------------------
  // PaymentLink operations
  // --------------------------------------------------------------------------

  async createPaymentLink(input: PaymentLinkCreateInput): Promise<PaymentLink> {
    const query = `
      mutation CreatePaymentLink($input: PaymentLinkCreateInput!) {
        paymentLink {
          create(input: $input) {
            ${PAYMENT_LINK_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { create: PaymentLink } }>(query, { input });
    return data.paymentLink.create;
  }

  async updatePaymentLink(id: number, input: PaymentLinkUpdateInput): Promise<PaymentLink> {
    const query = `
      mutation UpdatePaymentLink($id: Int!, $input: PaymentLinkUpdateInput!) {
        paymentLink {
          update(id: $id, input: $input) {
            ${PAYMENT_LINK_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { update: PaymentLink } }>(query, { id, input });
    return data.paymentLink.update;
  }

  async deletePaymentLink(id: number): Promise<boolean> {
    const query = `
      mutation DeletePaymentLink($id: Int!) {
        paymentLink {
          delete(id: $id)
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { delete: boolean } }>(query, { id });
    return data.paymentLink.delete;
  }

  async signPaymentLink(id: number, payerAddress: string): Promise<PaymentLink> {
    const query = `
      mutation SignPaymentLink($id: Int!, $input: PaymentLinkSignedInput!) {
        paymentLink {
          signed(id: $id, input: $input) {
            ${PAYMENT_LINK_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { signed: PaymentLink } }>(query, {
      id,
      input: { payerAddress },
    });
    return data.paymentLink.signed;
  }

  async getPaymentLink(filter: PaymentLinkFilter): Promise<PaymentLink | null> {
    const query = `
      query GetPaymentLink($filter: PaymentLinkFilter!) {
        paymentLink {
          one(filter: $filter) {
            ${PAYMENT_LINK_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { one: PaymentLink | null } }>(query, {
      filter,
    });
    return data.paymentLink.one;
  }

  async listPaymentLinks(
    filter?: PaymentLinkFilter | null,
    pagination?: PaginationInput,
  ): Promise<PaymentLinkConnection> {
    const query = `
      query ListPaymentLinks(
        $first: Int
        $after: String
        $last: Int
        $before: String
        $filter: PaymentLinkFilter
        $orderBy: [OrderByInput!]
      ) {
        paymentLink {
          many(
            first: $first
            after: $after
            last: $last
            before: $before
            filter: $filter
            orderBy: $orderBy
          ) {
            edges {
              node {
                ${PAYMENT_LINK_FIELDS}
              }
              cursor
            }
            ${PAGE_INFO_FRAGMENT}
            totalCount
          }
        }
      }
    `;
    const data = await this.execute<{ paymentLink: { many: PaymentLinkConnection } }>(query, {
      filter,
      ...pagination,
    });
    return data.paymentLink.many;
  }

  // --------------------------------------------------------------------------
  // Payment operations
  // --------------------------------------------------------------------------

  async verifyPayment(input: PaymentVerifyInput): Promise<Payment> {
    const query = `
      mutation VerifyPayment($input: PaymentVerifyInput!) {
        payment {
          verify(input: $input) {
            ${PAYMENT_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ payment: { verify: Payment } }>(query, { input });
    return data.payment.verify;
  }

  async managePayment(input: PaymentManageInput): Promise<PaymentActionSignatureResponse> {
    const query = `
      mutation ManagePayment($input: PaymentManageInput!) {
        payment {
          manage(input: $input) {
            signature
            escrowAddress
            operatorAddress
            nonce
            refundAmount
          }
        }
      }
    `;
    const data = await this.execute<{
      payment: { manage: PaymentActionSignatureResponse };
    }>(query, { input });
    return data.payment.manage;
  }

  async getPayment(filter: PaymentFilter): Promise<Payment | null> {
    const query = `
      query GetPayment($filter: PaymentFilter!) {
        payment {
          one(filter: $filter) {
            ${PAYMENT_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ payment: { one: Payment | null } }>(query, { filter });
    return data.payment.one;
  }

  async listPayments(
    filter?: PaymentFilter | null,
    pagination?: PaginationInput,
  ): Promise<PaymentConnection> {
    const query = `
      query ListPayments(
        $first: Int
        $after: String
        $last: Int
        $before: String
        $filter: PaymentFilter
        $orderBy: [OrderByInput!]
      ) {
        payment {
          many(
            first: $first
            after: $after
            last: $last
            before: $before
            filter: $filter
            orderBy: $orderBy
          ) {
            edges {
              node {
                ${PAYMENT_FIELDS}
              }
              cursor
            }
            ${PAGE_INFO_FRAGMENT}
            totalCount
          }
        }
      }
    `;
    const data = await this.execute<{ payment: { many: PaymentConnection } }>(query, {
      filter,
      ...pagination,
    });
    return data.payment.many;
  }

  // --------------------------------------------------------------------------
  // Token operations
  // --------------------------------------------------------------------------

  async getTokenById(filter: TokenFilter): Promise<Token | null> {
    const query = `
      query GetToken($filter: TokenFilter!) {
        token {
          one(filter: $filter) {
            ${TOKEN_FIELDS}
          }
        }
      }
    `;
    const data = await this.execute<{ token: { one: Token | null } }>(query, { filter });
    return data.token.one;
  }

  async listTokens(filter?: TokenFilter | null): Promise<TokenConnection> {
    const query = `
      query ListTokens($filter: TokenFilter) {
        token {
          many(filter: $filter) {
            edges {
              node {
                ${TOKEN_FIELDS}
              }
              cursor
            }
            ${PAGE_INFO_FRAGMENT}
            totalCount
          }
        }
      }
    `;
    const data = await this.execute<{ token: { many: TokenConnection } }>(query, { filter });
    return data.token.many;
  }
}
