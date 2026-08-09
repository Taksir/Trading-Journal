"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClipboardCheck } from "lucide-react"
import type { Setup } from "@/types/setup"
import type { TradingAccount } from "@/types/account"
import type { Trade } from "@/types/trade"
import { getAccountName } from "@/utils/account-analytics"
import { getReviewSignals, getReviewStatus } from "@/utils/trade-review"
import { sortClosedTradesByCloseDate, summarizeReview, getNeedsReviewCount } from "@/utils/review-analytics"
import { isTradeClosed } from "@/utils/quant-metrics"

type QueueFilter = "all" | "setup" | "grade" | "stop" | "process" | "notes"

interface ReviewQueueProps {
  trades: Trade[]
  setups: Setup[]
  accounts?: TradingAccount[]
  onReview: (trade: Trade) => void
  onView: (trade: Trade) => void
}

const FILTER_LABELS: { value: QueueFilter; label: string }[] = [
  { value: "all", label: "All Needs Review" },
  { value: "setup", label: "Missing Setup" },
  { value: "grade", label: "Missing Grade" },
  { value: "stop", label: "Missing Stop" },
  { value: "process", label: "Missing Process" },
  { value: "notes", label: "Missing Notes" },
]

/** Prominent-but-not-intrusive review queue. Respects the caller's account scope. */
export function ReviewQueue({ trades, setups, accounts = [], onReview, onView }: ReviewQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>("all")

  const summary = useMemo(() => summarizeReview(trades), [trades])
  const totalNeedsReview = useMemo(() => getNeedsReviewCount(trades), [trades])
  const queueTrades = useMemo(() => {
    const closed = trades.filter(isTradeClosed)
    const sorted = sortClosedTradesByCloseDate(closed)
    return sorted.filter((trade) => {
      if (getReviewStatus(trade) === "complete") return false
      const signals = getReviewSignals(trade)
      switch (filter) {
        case "setup":
          return !signals.hasSetup
        case "grade":
          return !signals.hasGrade
        case "stop":
          return !signals.hasStopInfo
        case "process":
          return !signals.processAnswered
        case "notes":
          return !signals.hasReviewNotes
        default:
          return true
      }
    })
  }, [trades, filter])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Review Queue</CardTitle>
          </div>
          <Badge variant={totalNeedsReview > 0 ? "destructive" : "default"}>
            {totalNeedsReview > 0 ? `${totalNeedsReview} need review` : "All caught up"}
          </Badge>
        </div>
        <CardDescription>
          {summary.complete} fully reviewed of {summary.totalClosed} closed trades
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTER_LABELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={
                filter === value
                  ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                  : "rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {queueTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this view. Nice.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto">
            {queueTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{trade.asset}</span>
                    <Badge variant="outline">
                      {getAccountName(accounts, trade.accountId)}
                    </Badge>
                    <span className={trade.pnl >= 0 ? "text-green-600" : "text-red-600"}>${trade.pnl}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {trade.date} {trade.time}
                    {trade.setupId && <span className="ml-2">Setup: {setupName(setups, trade.setupId)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {missingChips(trade)}
                  <Button variant="outline" size="sm" onClick={() => onView(trade)}>
                    View
                  </Button>
                  <Button size="sm" onClick={() => onReview(trade)}>
                    Review
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function setupName(setups: Setup[], setupId: string): string {
  const found = setups.find((setup) => setup.id === setupId)
  return found ? found.name : setupId
}

function missingChips(trade: Trade): React.ReactNode {
  const signals = getReviewSignals(trade)
  const missing: string[] = []
  if (!signals.hasSetup) missing.push("setup")
  if (!signals.hasGrade) missing.push("grade")
  if (!signals.hasStopInfo) missing.push("stop")
  if (!signals.processAnswered) missing.push("process")
  if (!signals.hasReviewNotes) missing.push("notes")
  return (
    <div className="hidden md:flex gap-1">
      {missing.slice(0, 3).map((item) => (
        <Badge key={item} variant="outline" className="text-[10px]">
          {item}
        </Badge>
      ))}
      {missing.length > 3 && (
        <Badge variant="outline" className="text-[10px]">
          +{missing.length - 3}
        </Badge>
      )}
    </div>
  )
}
