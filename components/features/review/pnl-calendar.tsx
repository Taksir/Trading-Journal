"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  groupClosedTradesByCloseDate,
  summarizeDailySeries,
  type CalendarDayPoint,
} from "@/utils/calendar-analytics"
import { GradeBadge } from "./review-badges"
import { formatDollars, formatPercent, formatR } from "./review-format"
import { getAccountName } from "@/utils/account-analytics"
import { getSetupName } from "@/utils/setups"
import type { Setup } from "@/types/setup"
import type { TradingAccount } from "@/types/account"
import type { Trade } from "@/types/trade"

interface PnlCalendarProps {
  points: CalendarDayPoint[]
  trades: Trade[]
  accounts?: TradingAccount[]
  setups?: Setup[]
  onView: (trade: Trade) => void
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function dayColor(netPnl: number): string {
  if (netPnl > 0) {
    const intensity = Math.min(0.25, 0.08 + Math.log2(1 + netPnl / 100) * 0.03)
    return `rgba(34,197,94,${Math.max(0.08, intensity)})`
  }
  if (netPnl < 0) {
    const intensity = Math.min(0.25, 0.08 + Math.log2(1 + -netPnl / 100) * 0.03)
    return `rgba(239,68,68,${Math.max(0.08, intensity)})`
  }
  return "transparent"
}

/** Daily P&L calendar. P&L/returns come from the account-aware daily series. */
export function PnlCalendar({ points, trades, accounts = [], setups = [], onView }: PnlCalendarProps) {
  const data = useMemo(() => summarizeDailySeries(points), [points])
  const tradesByDay = useMemo(() => groupClosedTradesByCloseDate(trades), [trades])

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const months = data.months
  const activeMonth = selectedMonth || (months.length > 0 ? months[months.length - 1].monthKey : null)

  const monthIndex = months.findIndex((month) => month.monthKey === activeMonth)

  const navigate = (delta: number) => {
    if (months.length === 0) return
    const target = Math.min(months.length - 1, Math.max(0, monthIndex + delta))
    setSelectedMonth(months[target].monthKey)
  }

  const month = months[monthIndex]
  const selectedDayTrades = selectedDay ? tradesByDay.get(selectedDay) || [] : []
  const selectedDayPoint = selectedDay ? data.byDay.get(selectedDay) : undefined

  const gridCells = useMemo(() => {
    if (!activeMonth) return []
    const [year, monthNumber] = activeMonth.split("-").map(Number)
    const firstOffset = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
    const cells: { date: string; day: number }[] = []
    for (let i = 0; i < firstOffset; i++) cells.push({ date: "", day: 0 })
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: `${activeMonth}-${pad(day)}`, day })
    }
    return cells
  }, [activeMonth])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily P&L Calendar</CardTitle>
        <CardDescription>
          Net realized trading P&L by close date. External cash flows are shown separately and never counted as
          trading P&L. All Accounts uses the capital-weighted aggregate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!month ? (
          <p className="text-sm text-muted-foreground">No closed trades yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={monthIndex <= 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center">
                <p className="text-lg font-semibold">{formatMonthLabel(month.monthKey)}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDollars(month.netPnl)} net •{" "}
                  {month.returnPct === null ? "—" : formatPercent(month.returnPct)} return • {month.tradingDays} trading
                  day{month.tradingDays === 1 ? "" : "s"} • {month.profitableDays} up / {month.losingDays} down
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(1)}
                disabled={monthIndex < 0 || monthIndex >= months.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-center text-xs font-medium text-muted-foreground py-1">
                  {label}
                </div>
              ))}
              {gridCells.map((cell, index) => {
                if (!cell.date) return <div key={`blank-${index}`} />
                const day = data.byDay.get(cell.date)
                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => day && setSelectedDay(cell.date)}
                    disabled={!day}
                    className={`rounded-md border p-1.5 text-left text-sm min-h-[56px] transition-colors ${
                      day ? "hover:bg-accent cursor-pointer" : "text-muted-foreground/40"
                    }`}
                    style={day ? { backgroundColor: dayColor(day.netPnl) } : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{cell.day}</span>
                      {day && (
                        <span className={`text-[10px] ${day.netPnl >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {day.returnPct === null ? "" : formatPercent(day.returnPct, 1)}
                        </span>
                      )}
                    </div>
                    {day && (
                      <div
                        className={`text-xs font-semibold ${day.netPnl >= 0 ? "text-green-700" : "text-red-700"}`}
                      >
                        {day.netPnl >= 0 ? "+" : ""}
                        {formatDollars(day.netPnl)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {month.bestDay && month.worstDay && (
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>
                  Best day: <span className="font-medium text-green-600">{month.bestDay.date}</span>{" "}
                  {formatDollars(month.bestDay.netPnl)}
                </span>
                <span>
                  Worst day: <span className="font-medium text-red-600">{month.worstDay.date}</span>{" "}
                  {formatDollars(month.worstDay.netPnl)}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!selectedDay} onOpenChange={(next) => !next && setSelectedDay(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Trades closed on {selectedDay}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-auto">
            {selectedDayTrades.length === 0 && <p className="text-sm text-muted-foreground">No trades.</p>}
            {selectedDayTrades.map((trade) => (
              <div key={trade.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{trade.asset}</span>
                    <Badge variant="outline">{getAccountName(accounts, trade.accountId)}</Badge>
                    <GradeBadge grade={trade.manualSetupGrade} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getSetupName(setups, trade.setupId) || "No setup"} • {trade.tradeType} • {trade.rMultiple.toFixed(2)}R
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-medium ${trade.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatDollars(trade.pnl)}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => onView(trade)}>
                    View
                  </Button>
                </div>
              </div>
            ))}
            {selectedDayPoint && Math.abs(selectedDayPoint.adjustments) > 0.0001 && (
              <div className="rounded-md border border-dashed p-2 text-sm">
                <span className="text-xs text-muted-foreground">External cash flow:</span>{" "}
                <span className="font-medium">{formatDollars(selectedDayPoint.adjustments)}</span>{" "}
                <span className="text-xs text-muted-foreground">(excluded from trading P&L above)</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function formatMonthLabel(monthKey: string): string {
  const [year, monthNumber] = monthKey.split("-").map(Number)
  const label = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
  return label
}
