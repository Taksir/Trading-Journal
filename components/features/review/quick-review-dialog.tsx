"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { MistakePicker } from "./mistake-picker"
import { getAccountName } from "@/utils/account-analytics"
import { getTradeReturnPct } from "@/utils/trade-review"
import { normalizeMistakeIds } from "@/utils/review-analytics"
import type { ReviewPatch } from "@/types/review"
import type { Setup } from "@/types/setup"
import type { TradingAccount } from "@/types/account"
import type { ManualSetupGrade, Trade } from "@/types/trade"

interface QuickReviewDialogProps {
  open: boolean
  trade: Trade | null
  queue: Trade[]
  setups: Setup[]
  accounts?: TradingAccount[]
  onApplyPatch: (tradeId: string, patch: ReviewPatch) => void
  onOpenTrade: (trade: Trade | null) => void
  onClose: () => void
}

const MANUAL_GRADES: Exclude<ManualSetupGrade, null>[] = ["A+", "A", "B", "C", "D", "F"]

/** Review-only editor. Financial fields are never editable or submitted here. */
export function QuickReviewDialog({
  open,
  trade,
  queue,
  setups,
  accounts = [],
  onApplyPatch,
  onOpenTrade,
  onClose,
}: QuickReviewDialogProps) {
  const [setupId, setSetupId] = useState("")
  const [manualGrade, setManualGrade] = useState<string>("")
  const [processValue, setProcessValue] = useState<boolean | null>(null)
  const [mistakes, setMistakes] = useState<string[]>([])
  const [thesis, setThesis] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (trade) {
      setSetupId(trade.setupId || "")
      setManualGrade(trade.manualSetupGrade || "")
      setProcessValue(trade.manualProcessFollowed ?? null)
      setMistakes(trade.manualMistakeIds || [])
      setThesis(trade.tradeThesis || "")
      setNotes(trade.reviewNotes || "")
    }
  }, [trade?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!trade) return null

  const buildPatch = (): ReviewPatch => ({
    ...(setupId ? { setupId } : { setupId: undefined }),
    ...(manualGrade ? { manualSetupGrade: manualGrade as ManualSetupGrade } : { manualSetupGrade: undefined }),
    ...(processValue !== null ? { manualProcessFollowed: processValue } : { manualProcessFollowed: undefined }),
    ...(mistakes.length > 0
      ? { manualMistakeIds: normalizeMistakeIds(mistakes) }
      : { manualMistakeIds: undefined }),
    ...(thesis.trim() ? { tradeThesis: thesis.trim() } : { tradeThesis: undefined }),
    ...(notes.trim() ? { reviewNotes: notes.trim() } : { reviewNotes: undefined }),
  })

  const handleSave = () => {
    onApplyPatch(trade.id, buildPatch())
    onClose()
  }

  const handleSaveAndNext = () => {
    onApplyPatch(trade.id, buildPatch())
    const index = queue.findIndex((candidate) => candidate.id === trade.id)
    const next = index >= 0 ? queue[index + 1] : undefined
    if (next) onOpenTrade(next)
    else onClose()
  }

  const returnPct = getTradeReturnPct(trade)
  const accountName = getAccountName(accounts, trade.accountId)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quick Review</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-lg border p-3 text-sm">
          <div>
            <p className="text-muted-foreground">Asset</p>
            <p className="font-semibold">{trade.asset}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Account</p>
            <p className="font-semibold">{accountName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">P&L</p>
            <p className={`font-semibold ${trade.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>${trade.pnl}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Return / R</p>
            <p className="font-semibold">
              {returnPct === null ? "—" : `${returnPct.toFixed(2)}%`} / {trade.rMultiple.toFixed(2)}R
            </p>
          </div>
        </div>

        <div className="space-y-4 overflow-auto max-h-[calc(100vh-380px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Setup</Label>
              <Select value={setupId || "placeholder"} onValueChange={(value) => setSetupId(value === "placeholder" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select setup" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="placeholder" disabled>
                    Select setup
                  </SelectItem>
                  {setups.map((setup) => (
                    <SelectItem key={setup.id} value={setup.id}>
                      {setup.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Manual Setup Grade</Label>
              <Select value={manualGrade || "placeholder"} onValueChange={(value) => setManualGrade(value === "placeholder" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Grade the setup" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="placeholder" disabled>
                    Grade the setup
                  </SelectItem>
                  {MANUAL_GRADES.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Process</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: true as boolean | null, label: "Followed" },
                { value: false as boolean | null, label: "Violated" },
                { value: null as boolean | null, label: "Not reviewed" },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setProcessValue(option.value)}
                  className={
                    processValue === option.value
                      ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                      : "rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Mistakes</Label>
            <MistakePicker value={mistakes} onChange={setMistakes} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quickThesis">Trade Thesis</Label>
            <Input
              id="quickThesis"
              placeholder="Why did I take this trade?"
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quickNotes">Review Notes</Label>
            <Textarea
              id="quickNotes"
              placeholder="What did I learn? Was the setup/execution clean?"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {mistakes.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{mistakes.length} mistake{mistakes.length === 1 ? "" : "s"} tagged</Badge>
              <span>Review-only — financial fields are never changed here.</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={handleSave}>
            Save
          </Button>
          <Button type="button" onClick={handleSaveAndNext}>
            Save &amp; Next
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
