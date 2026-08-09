"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { X, Plus, Trash2, AlertTriangle, Pencil } from "lucide-react"
import type { TradingAccount } from "@/types/account"
import type { Trade } from "@/types/trade"
import { accountHasTrades } from "@/utils/account-migration"

interface AccountManagerProps {
  accounts: TradingAccount[]
  trades: Trade[]
  onAddAccount: (account: Omit<TradingAccount, "id" | "createdAt">) => void
  onUpdateAccount: (account: TradingAccount) => void
  onDeleteAccount: (id: string) => void
  onCancel: () => void
}

const DEFAULT_STARTING_BALANCE = 100

export function AccountManager({
  accounts,
  trades,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onCancel,
}: AccountManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [broker, setBroker] = useState("")
  const [startingBalance, setStartingBalance] = useState<number>(DEFAULT_STARTING_BALANCE)
  const [startingDate, setStartingDate] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const startEdit = (account: TradingAccount) => {
    setEditingId(account.id)
    setName(account.name)
    setBroker(account.broker || "")
    setStartingBalance(account.startingBalance)
    setStartingDate(account.startingDate || "")
    setCurrency(account.currency)
    setConfirmDeleteId(null)
  }

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setBroker("")
    setStartingBalance(DEFAULT_STARTING_BALANCE)
    setStartingDate("")
    setCurrency("USD")
  }

  const nameInUse = accounts.some(
    (account) => account.id !== editingId && account.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || nameInUse) return

    if (editingId) {
      const existing = accounts.find((account) => account.id === editingId)
      if (existing) {
        onUpdateAccount({
          ...existing,
          name: trimmed,
          broker: broker.trim() || undefined,
          startingBalance: startingBalance > 0 ? startingBalance : DEFAULT_STARTING_BALANCE,
          startingDate: startingDate || undefined,
          currency: currency || "USD",
          updatedAt: new Date().toISOString(),
        })
      }
    } else {
      onAddAccount({
        name: trimmed,
        broker: broker.trim() || undefined,
        startingBalance: startingBalance > 0 ? startingBalance : DEFAULT_STARTING_BALANCE,
        startingDate: startingDate || undefined,
        currency: currency || "USD",
      })
    }
    resetForm()
  }

  const handleDelete = (account: TradingAccount) => {
    if (accountHasTrades(account.id, trades) > 0) return
    if (confirmDeleteId === account.id) {
      onDeleteAccount(account.id)
      setConfirmDeleteId(null)
      if (editingId === account.id) resetForm()
    } else {
      setConfirmDeleteId(account.id)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Manage Accounts</CardTitle>
              <CardDescription>
                Create and maintain trading accounts. Trades and balance adjustments belong to exactly one account.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg">
            <h3 className="font-semibold">{editingId ? "Edit Account" : "Add Account"}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="acc-name">Name</Label>
                <Input
                  id="acc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Fidelity Main"
                  required
                />
                {nameInUse && (
                  <p className="text-sm text-destructive mt-1">Another account already uses this name.</p>
                )}
              </div>
              <div>
                <Label htmlFor="acc-broker">Broker (optional)</Label>
                <Input
                  id="acc-broker"
                  value={broker}
                  onChange={(e) => setBroker(e.target.value)}
                  placeholder="e.g. Fidelity, Exness"
                />
              </div>
              <div>
                <Label htmlFor="acc-currency">Currency</Label>
                <Input
                  id="acc-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="USD"
                />
              </div>
              <div>
                <Label htmlFor="acc-start-balance">Starting Balance ($)</Label>
                <Input
                  id="acc-start-balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={startingBalance || ""}
                  onChange={(e) => setStartingBalance(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="acc-start-date">Starting Date (optional)</Label>
                <Input
                  id="acc-start-date"
                  type="date"
                  value={startingDate}
                  onChange={(e) => setStartingDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="gap-2" disabled={!name.trim() || nameInUse}>
                {editingId ? (
                  <>
                    <Plus className="h-4 w-4" />
                    Save Changes
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Add Account
                  </>
                )}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel Edit
                </Button>
              )}
            </div>
          </form>

          <div>
            <h3 className="font-semibold mb-3">Accounts ({accounts.length})</h3>
            {accounts.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No accounts yet. Add one above.</p>
            ) : (
              <ScrollArea className="h-[280px] pr-4">
                <div className="space-y-3">
                  {accounts.map((account) => {
                    const tradeCount = accountHasTrades(account.id, trades)
                    return (
                      <Card key={account.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{account.name}</span>
                              <Badge variant="secondary">{account.currency}</Badge>
                              {account.broker && <Badge variant="outline">{account.broker}</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Starting balance ${account.startingBalance.toFixed(2)}
                              {account.startingDate ? ` • since ${account.startingDate}` : ""} • {tradeCount} trade
                              {tradeCount === 1 ? "" : "s"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(account)}
                              className="gap-1"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive gap-1"
                              disabled={tradeCount > 0}
                              title={
                                tradeCount > 0
                                  ? "Accounts with trades cannot be deleted. Move or remove its trades first."
                                  : "Delete account"
                              }
                              onClick={() => handleDelete(account)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {confirmDeleteId === account.id ? (
                                <span className="flex items-center gap-1">
                                  <AlertTriangle className="h-4 w-4" />
                                  Confirm
                                </span>
                              ) : (
                                "Delete"
                              )}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
