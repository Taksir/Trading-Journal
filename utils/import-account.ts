import type { TradingAccount } from "../types/account.ts"
import type { Trade } from "../types/trade.ts"

/**
 * Import-time account destination logic (pure, Node-testable).
 *
 * Design rules enforced here:
 * - A new CSV import MUST have an explicit destination: an existing account the
 *   user selected, or a NEW account the user is creating in the dialog. There is
 *   NO implicit "Default Account" fallback for new imports. (Legacy migration of
 *   pre-account history still routes to the Default Account elsewhere — that is
 *   the migration architecture, not the import workflow.)
 * - A new account's `startingBalance` is BASELINE EQUITY before the imported
 *   history begins. It is never treated as a deposit, a balance adjustment, or
 *   P&L (the import flow produces no adjustments at all).
 * - A new account's `startingDate` is derived from the imported history:
 *   1. the earliest valid trade ENTRY date (`date`),
 *   2. otherwise the earliest valid trade CLOSE date (`endDate`),
 *   3. otherwise undefined — we never fabricate an arbitrary historical date.
 *   Using the entry date (not the close date) keeps the starting capital in the
 *   daily-return / Sharpe / Sortino / drawdown denominators from the very first
 *   day the position was opened.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateKey(value: string | undefined | null): boolean {
  return Boolean(value && DATE_KEY_PATTERN.test(value))
}

export interface NewAccountSpec {
  name: string
  broker?: string
  startingBalance: number
  currency: string
}

export type ImportDestination =
  | { kind: "existing"; accountId: string }
  | { kind: "new"; spec: NewAccountSpec; accountId: string }

export interface ImportPayload {
  trades: Omit<Trade, "id">[]
  duplicates: string[]
  destination: ImportDestination
}

/**
 * Validate a new-account spec. Returns a human-readable error or null.
 * Rejects empty/whitespace names, NaN, Infinity, and negative starting balance.
 */
export function validateNewAccountSpec(spec: NewAccountSpec): string | null {
  const name = (spec?.name || "").trim()
  if (!name) return "Account Name is required when creating a new account."
  const balance = Number(spec?.startingBalance)
  if (!Number.isFinite(balance)) return "Starting Balance must be a valid number."
  if (balance < 0) return "Starting Balance cannot be negative."
  if ((spec?.currency || "").trim() === "") return "Currency is required."
  return null
}

/**
 * Automatic account starting date from imported trades. See module docs for the
 * exact rule (earliest valid entry date, else earliest valid close date, else
 * none).
 */
export function computeAccountStartingDate(
  trades: Array<{ date?: string | null; endDate?: string | null }>,
): string | undefined {
  let earliestEntry: string | undefined
  let earliestClose: string | undefined
  for (const trade of trades) {
    const entry = typeof trade.date === "string" ? trade.date : undefined
    if (entry !== undefined && isValidDateKey(entry) && (earliestEntry === undefined || entry < earliestEntry)) {
      earliestEntry = entry
    }
    const close = typeof trade.endDate === "string" ? trade.endDate : undefined
    if (close !== undefined && isValidDateKey(close) && (earliestClose === undefined || close < earliestClose)) {
      earliestClose = close
    }
  }
  return earliestEntry ?? earliestClose
}

/**
 * Build the account to create for an import. Validates the spec and computes the
 * starting date. Returns the account (WITHOUT `createdAt`, which the caller
 * stamps) or an error — never a partial/empty account.
 */
export function buildImportAccount(input: {
  spec: NewAccountSpec
  trades: Array<{ date?: string | null; endDate?: string | null }>
  accountId: string
}): { ok: true; account: Omit<TradingAccount, "createdAt"> } | { ok: false; error: string } {
  const validationError = validateNewAccountSpec(input.spec)
  if (validationError) return { ok: false, error: validationError }
  const id = (input.accountId || "").trim()
  if (!id) return { ok: false, error: "A new account id is required." }
  const startingDate = computeAccountStartingDate(input.trades)
  return {
    ok: true,
    account: {
      id,
      name: input.spec.name.trim(),
      broker: input.spec.broker?.trim() || undefined,
      startingBalance: Number(input.spec.startingBalance),
      startingDate,
      currency: input.spec.currency.trim() || "USD",
    },
  }
}

/** Assign an accountId to every trade (idempotent; never mutates input). */
export function stampAccountId<T extends { accountId?: string }>(trades: T[], accountId: string): T[] {
  return trades.map((trade) => ({ ...trade, accountId }))
}

/**
 * Resolve and prepare a completed import:
 * - existing destination -> validate the account exists, stamp its id
 * - new destination     -> validate the spec, build the account, stamp its id
 *
 * Returns an error (and no account/trades) for ANY missing or invalid
 * destination. There is no branch that silently assigns to the Default Account.
 */
export function prepareImport(input: {
  trades: Omit<Trade, "id">[]
  destination: ImportDestination
  existingAccounts: TradingAccount[]
}):
  | { ok: true; trades: Omit<Trade, "id">[]; account?: Omit<TradingAccount, "createdAt"> }
  | { ok: false; error: string } {
  const { trades, destination, existingAccounts } = input

  if (destination.kind === "existing") {
    const id = (destination.accountId || "").trim()
    if (!id) {
      return { ok: false, error: "Select an account to import into, or choose Create New Account." }
    }
    if (!existingAccounts.some((account) => account.id === id)) {
      return {
        ok: false,
        error: "The selected destination account no longer exists. Choose another account or create a new one.",
      }
    }
    return { ok: true, trades: stampAccountId(trades, id) }
  }

  const built = buildImportAccount({ spec: destination.spec, trades, accountId: destination.accountId })
  if (!built.ok) return built
  return { ok: true, trades: stampAccountId(trades, built.account.id), account: built.account }
}
