import type { AccountScope, TradingAccount } from "@/types/account"

/**
 * Pure scope helpers. Kept in a value module (not `types/account.ts`) so other
 * pure utilities can import them without `@/` runtime aliases.
 */

export function scopeIncludesAccount(scope: AccountScope, accountId: string | undefined): boolean {
  if (scope.kind === "all") return true
  return Boolean(accountId && scope.accountIds.includes(accountId))
}

export function scopeAccounts(scope: AccountScope, accounts: TradingAccount[]): TradingAccount[] {
  if (scope.kind === "all") return accounts
  return accounts.filter((account) => scope.accountIds.includes(account.id))
}

export function isSingleAccountScope(scope: AccountScope): boolean {
  return scope.kind === "selected" && scope.accountIds.length === 1
}

export function singleAccountId(scope: AccountScope): string | null {
  return scope.kind === "selected" && scope.accountIds.length === 1 ? scope.accountIds[0] : null
}

export function scopeLabel(scope: AccountScope, accounts: TradingAccount[]): string {
  if (scope.kind === "all") return "All Accounts"
  const names = accounts
    .filter((account) => scope.accountIds.includes(account.id))
    .map((account) => account.name)
  return names.length > 0 ? names.join(", ") : "No Accounts"
}
