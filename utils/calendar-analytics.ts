import type { Trade } from "../types/trade.ts"
import type { DailyEquityPoint } from "./account-analytics.ts"
import { getCloseDateKey, isTradeClosed } from "./quant-metrics.ts"

/**
 * Pure calendar analytics for the Daily P&L Calendar.
 *
 * The daily P&L and return% come from the ACCOUNT-AWARE daily series built by
 * `utils/account-analytics.ts` (`buildAccountDailySeries` for a single account,
 * `buildAggregateDailySeries` — capital-weighted — for All Accounts). The
 * component feeds those series points into `summarizeDailySeries` here; this
 * module only aggregates and groups, it never recomputes equity or returns.
 * Balance adjustments ride along as `adjustments` and are reported separately
 * as "External cash flow" — they never enter trading P&L or return %.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safePnl(trade: Trade): number {
  const value = Number(trade.pnl)
  return isFiniteNumber(value) ? value : 0
}

/** Minimal per-day series point (structurally compatible with DailyEquityPoint). */
export interface CalendarDayPoint {
  date: string
  netPnl: number
  returnPct: number | null
  adjustments: number
}

export interface CalendarDay {
  date: string
  netPnl: number
  returnPct: number | null
  adjustments: number
}

export interface CalendarMonth {
  monthKey: string // "YYYY-MM"
  netPnl: number
  /** Compounded daily trading returns over the month's trading days (%). */
  returnPct: number | null
  profitableDays: number
  losingDays: number
  bestDay: CalendarDay | null
  worstDay: CalendarDay | null
  tradingDays: number
}

export interface CalendarData {
  byDay: Map<string, CalendarDay>
  months: CalendarMonth[] // ascending by monthKey
}

/** Closed trades grouped by close date key (YYYY-MM-DD). */
export function groupClosedTradesByCloseDate(trades: Trade[]): Map<string, Trade[]> {
  const map = new Map<string, Trade[]>()
  for (const trade of trades) {
    if (!isTradeClosed(trade)) continue
    const key = getCloseDateKey(trade)
    if (!DATE_KEY_PATTERN.test(key)) continue
    const list = map.get(key) || []
    list.push(trade)
    map.set(key, list)
  }
  return map
}

/**
 * Convert an account-aware daily series (single-account or capital-weighted
 * aggregate) into calendar day points. The trading P&L is `realizedPnl`; the
 * external cash flow rides along as `adjustments` for separate display.
 */
export function toCalendarDayPoints(points: DailyEquityPoint[]): CalendarDayPoint[] {
  return points.map((point) => ({
    date: point.date,
    netPnl: isFiniteNumber(point.realizedPnl) ? point.realizedPnl : 0,
    returnPct: isFiniteNumber(point.returnPct) ? point.returnPct : null,
    adjustments: isFiniteNumber(point.netAdjustments) ? point.netAdjustments : 0,
  }))
}

/**
 * Aggregate a daily series into per-day P&L and per-month summaries.
 * `byDay` keys only the days that exist in the series; `months` is ascending.
 */
export function summarizeDailySeries(points: CalendarDayPoint[]): CalendarData {
  const byDay = new Map<string, CalendarDay>()
  const monthMap = new Map<string, CalendarMonth>()

  for (const point of points) {
    if (!point || !DATE_KEY_PATTERN.test(point.date)) continue
    byDay.set(point.date, {
      date: point.date,
      netPnl: isFiniteNumber(point.netPnl) ? point.netPnl : 0,
      returnPct: isFiniteNumber(point.returnPct) ? point.returnPct : null,
      adjustments: isFiniteNumber(point.adjustments) ? point.adjustments : 0,
    })

    const monthKey = point.date.slice(0, 7)
    let month = monthMap.get(monthKey)
    if (!month) {
      month = {
        monthKey,
        netPnl: 0,
        returnPct: null,
        profitableDays: 0,
        losingDays: 0,
        bestDay: null,
        worstDay: null,
        tradingDays: 0,
      }
      monthMap.set(monthKey, month)
    }

    const netPnl = isFiniteNumber(point.netPnl) ? point.netPnl : 0
    month.tradingDays += 1
    month.netPnl += netPnl
    if (netPnl > 0) month.profitableDays += 1
    if (netPnl < 0) month.losingDays += 1

    const day: CalendarDay = {
      date: point.date,
      netPnl,
      returnPct: isFiniteNumber(point.returnPct) ? point.returnPct : null,
      adjustments: isFiniteNumber(point.adjustments) ? point.adjustments : 0,
    }
    if (!month.bestDay || day.netPnl > month.bestDay.netPnl) month.bestDay = day
    if (!month.worstDay || day.netPnl < month.worstDay.netPnl) month.worstDay = day
  }

  // Monthly return % = compounded daily trading returns over that month.
  for (const month of monthMap.values()) {
    let factor = 1
    let hasReturn = false
    for (const point of points) {
      if (!point || point.date.slice(0, 7) !== month.monthKey) continue
      const r = isFiniteNumber(point.returnPct) ? point.returnPct : null
      if (r === null) continue
      factor *= 1 + r / 100
      hasReturn = true
    }
    month.returnPct = hasReturn ? (factor - 1) * 100 : null
  }

  const months = [...monthMap.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
  return { byDay, months }
}

/** Net P&L of a list of closed trades (single day). */
export function sumClosedTradePnl(trades: Trade[]): number {
  return trades.reduce((sum, trade) => sum + safePnl(trade), 0)
}
