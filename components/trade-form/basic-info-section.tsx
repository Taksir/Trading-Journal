"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TradingAccount } from "@/types/account"

interface BasicInfoSectionProps {
  formData: {
    date: string
    time: string
    asset: string
    ticket?: string
    accountId?: string
  }
  onChange: (field: string, value: string) => void
  availableAssets: string[]
  accounts?: TradingAccount[]
  hasClose?: boolean
  onHasCloseChange?: (value: boolean) => void
}

export function BasicInfoSection({
  formData,
  onChange,
  availableAssets,
  accounts = [],
  hasClose = true,
  onHasCloseChange,
}: BasicInfoSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Basic Information</h3>
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div>
          <Label htmlFor="hasClose" className="text-sm font-medium">Trade is closed</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasClose
              ? "Closed trades count toward your performance metrics."
              : "Open trades are excluded from performance metrics until you close them."}
          </p>
        </div>
        <Switch
          id="hasClose"
          checked={hasClose}
          onCheckedChange={(value) => onHasCloseChange?.(value)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {accounts.length > 0 && (
          <div>
            <Label htmlFor="accountId">Account</Label>
            <Select
              value={formData.accountId || "placeholder"}
              onValueChange={(value) => onChange("accountId", value === "placeholder" ? "" : value)}
            >
              <SelectTrigger id="accountId">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="placeholder" disabled>
                  Select account
                </SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={formData.date}
            onChange={(e) => onChange("date", e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="time">Time</Label>
          <Input
            id="time"
            type="time"
            value={formData.time}
            onChange={(e) => onChange("time", e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="asset">Asset</Label>
          <Select
            value={formData.asset || "placeholder"}
            onValueChange={(value) => onChange("asset", value === "placeholder" ? "" : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select asset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="placeholder" disabled>
                Select asset
              </SelectItem>
              {availableAssets.map((asset) => (
                <SelectItem key={asset} value={asset}>
                  {asset}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="ticket">Ticket (Optional)</Label>
          <Input
            id="ticket"
            placeholder="Broker ticket ID"
            value={formData.ticket}
            onChange={(e) => onChange("ticket", e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
