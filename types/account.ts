/**
 * First-class trading account model.
 *
 * Accounts are entities with STABLE ids. Trades and balance adjustments
 * reference accounts via `accountId`; display names are never used as foreign
 * keys, so renaming an account never breaks the data model.
 *
 * Scope helper functions live in `utils/account-scope.ts` so pure utility
 * modules can stay free of `@/` runtime aliases (testable under plain Node).
 */

export interface TradingAccount {
  /** Stable locally-generated id. Never derived from the brokerage account number. */
  id: string
  /** User-facing display name. Does not need to be globally unique. */
  name: string
  /** Broker name (e.g. "Fidelity", "Exness"). Optional. */
  broker?: string
  /** Starting account equity at `startingDate`. */
  startingBalance: number
  /** ISO date (YYYY-MM-DD) the account started. Optional. */
  startingDate?: string
  /** ISO currency code, e.g. "USD". */
  currency: string
  createdAt: string
  updatedAt?: string
}

/**
 * Account selection scope used across the whole journal.
 *
 * `{ kind: "all" }` aggregates every account; `{ kind: "selected" }` is a
 * multi-select set of account ids. Components derive their data from a single
 * scope object instead of scattering `trade.accountId === ...` checks.
 */
export type AccountScope = { kind: "all" } | { kind: "selected"; accountIds: string[] }
