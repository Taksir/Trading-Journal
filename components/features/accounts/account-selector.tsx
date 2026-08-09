"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Settings2 } from "lucide-react"
import type { AccountScope, TradingAccount } from "@/types/account"
import type { BalanceAdjustment, Trade } from "@/types/trade"
import {
  calculateScopeAdjustedBalance,
  getAccountBalance,
} from "@/utils/account-analytics"
import { scopeAccounts } from "@/utils/account-scope"

interface AccountSelectorProps {
  scope: AccountScope
  accounts: TradingAccount[]
  trades: Trade[]
  adjustments: BalanceAdjustment[]
  onScopeChange: (scope: AccountScope) => void
  onManageAccounts: () => void
}

function formatBalance(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function AccountSelector({
  scope,
  accounts,
  trades,
  adjustments,
  onScopeChange,
  onManageAccounts,
}: AccountSelectorProps) {
  const scopedAccounts = scopeAccounts(scope, accounts)

  const scopeValue =
    scope.kind === "all"
      ? "all"
      : scope.accountIds.length === 1
        ? scope.accountIds[0]
        : "all"

  const balance =
    scope.kind === "all"
      ? calculateScopeAdjustedBalance(scope, accounts, trades, adjustments)
      : scopedAccounts.reduce((sum, account) => sum + getAccountBalance(account, trades, adjustments), 0)

  const label = scope.kind === "all" ? "All Accounts" : scopedAccounts.map((a) => a.name).join(", ")

  return (
    <div className="flex items-center gap-2">
      <Select
        value={scopeValue}
        onValueChange={(value) => {
          if (value === "all") {
            onScopeChange({ kind: "all" })
          } else {
            const accountId = value
            onScopeChange(accountId ? { kind: "selected", accountIds: [accountId] } : { kind: "all" })
          }
        }}
      >
        <SelectTrigger className="w-[240px]">
          <SelectValue>{`${label} • ${formatBalance(balance)}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{`All Accounts • ${formatBalance(
            calculateScopeAdjustedBalance({ kind: "all" }, accounts, trades, adjustments),
          )}`}</SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {`${account.name} • ${formatBalance(getAccountBalance(account, trades, adjustments))}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" onClick={onManageAccounts} title="Manage accounts">
        <Settings2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
