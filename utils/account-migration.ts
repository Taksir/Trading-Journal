import type { TradingAccount } from "@/types/account"
import type { BalanceAdjustment, Settings, Trade } from "@/types/trade"

/**
 * Legacy -> multi-account migration.
 *
 * Strategy (idempotent, safe):
 * - Trades and balance adjustments without an `accountId` are associated with a
 *   single default account that is created on first load.
 * - The default account uses a FIXED id, so running the migration multiple
 *   times can never create duplicate accounts.
 * - Every other trade/adjustment field is left untouched; the migration only
 *   ADDS the `accountId` association.
 * - The migration operates purely on in-memory loaded data. Persistence happens
 *   only through the normal application save flow.
 *
 * Schema versioning is minimal: a single integer key that future phases can
 * bump when they introduce new migrations.
 */

export const DEFAULT_ACCOUNT_ID = "account-default"
export const SCHEMA_VERSION = 2
export const ACCOUNTS_STORAGE_KEY = "trading-journal-accounts"
export const SCHEMA_VERSION_KEY = "trading-journal-schema-version"

export function buildDefaultAccount(startingBalance: number, nowIso?: string): TradingAccount {
  return {
    id: DEFAULT_ACCOUNT_ID,
    name: "Default Account",
    startingBalance: isFiniteNumber(startingBalance) && startingBalance > 0 ? startingBalance : 100,
    currency: "USD",
    createdAt: nowIso || new Date().toISOString(),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export interface MigrationInput {
  trades: Trade[]
  settings?: Partial<Settings> | null
  balanceAdjustments: BalanceAdjustment[]
  accounts: TradingAccount[]
  nowIso?: string
}

export interface MigrationResult {
  accounts: TradingAccount[]
  trades: Trade[]
  balanceAdjustments: BalanceAdjustment[]
  schemaVersion: number
  didMigrate: boolean
}

/**
 * Ensure every trade/adjustment references an existing account, creating the
 * default account when none exists. Returns new arrays when changes are needed
 * and the SAME references when nothing changed (idempotent, no-op friendly).
 */
export function ensureAccountsMigration(input: MigrationInput): MigrationResult {
  const { trades, settings, balanceAdjustments, accounts, nowIso } = input

  const safeAccounts = Array.isArray(accounts) ? accounts : []
  let nextAccounts = safeAccounts

  const accountExists = (id: string | undefined): boolean =>
    Boolean(id && nextAccounts.some((account) => account.id === id))

  let didMigrate = false

  // Orphan detection must run against the accounts that exist before the
  // default account is created below.
  const orphanTradesExist = (trades || []).some((trade) => !accountExists(trade?.accountId))
  const orphanAdjustmentsExist = (balanceAdjustments || []).some(
    (adjustment) => !accountExists(adjustment?.accountId),
  )

  // Create the default account exactly once: when there are no accounts at all,
  // or when orphan trades/adjustments need a home. Orphans ALWAYS go to the
  // default account so they are never conflated with intentional account data.
  if (!accountExists(DEFAULT_ACCOUNT_ID) && (safeAccounts.length === 0 || orphanTradesExist || orphanAdjustmentsExist)) {
    const base = settings?.accountBalance
    nextAccounts = [...nextAccounts, buildDefaultAccount(isFiniteNumber(base) ? base : 0, nowIso)]
    didMigrate = true
  }

  // Associate orphan trades with the default account.
  let nextTrades = trades
  if (orphanTradesExist && nextAccounts.length > 0) {
    nextTrades = (trades || []).map((trade) =>
      trade && !accountExists(trade.accountId) ? { ...trade, accountId: DEFAULT_ACCOUNT_ID } : trade,
    )
    didMigrate = true
  }

  // Associate orphan balance adjustments with the default account.
  let nextAdjustments = balanceAdjustments
  if (orphanAdjustmentsExist && nextAccounts.length > 0) {
    nextAdjustments = (balanceAdjustments || []).map((adjustment) =>
      adjustment && !accountExists(adjustment.accountId)
        ? { ...adjustment, accountId: DEFAULT_ACCOUNT_ID }
        : adjustment,
    )
    didMigrate = true
  }

  return {
    accounts: nextAccounts,
    trades: nextTrades,
    balanceAdjustments: nextAdjustments,
    schemaVersion: SCHEMA_VERSION,
    didMigrate,
  }
}

export function accountHasTrades(accountId: string, trades: Trade[]): number {
  return (trades || []).filter((trade) => trade.accountId === accountId).length
}
