import type { BalanceAdjustment, Trade } from "../types/trade.ts"
import { groupClosedTradesByCloseDate, sumClosedTradePnl } from "./calendar-analytics.ts"

/**
 * Cumulative realized P&L series for the main-page P&L chart (pure, Node-testable).
 *
 * Conventions (documented, deterministic, matching the rest of the journal):
 * - Realized P&L enters the series when a trade is CLOSED (`endDate` present),
 *   keyed by the canonical close date (`getCloseDateKey`). Open trades NEVER
 *   contribute — this is a realized P&L chart, not a position chart.
 * - Daily aggregation: multiple trades closing the same day are summed into one
 *   daily point. Closed breakevens contribute $0 but still count as closed trades
 *   that day. This mirrors `groupClosedTradesByCloseDate` / `sumClosedTradePnl`
 *   so there is exactly ONE definition of daily trading P&L.
 * - The primary value `cumulativePnl` is the chronological running total of
 *   realized trading P&L ONLY. Starting capital, deposits and withdrawals are
 *   never counted as profit.
 * - Points are sorted ascending by close date. The input array is NEVER mutated.
 * - Scope/aggregation is the caller's job: pass already-scope-filtered trades for
 *   a single account, or all accounts' trades for the All Accounts view (the
 *   series simply sums realized P&L chronologically — it never averages).
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** One daily point of the P&L chart. */
export interface PnlSeriesPoint {
  /** Close date key `YYYY-MM-DD`. */
  date: string
  /** Sum of realized trade P&L on that close date. */
  dailyPnl: number
  /** Running total of realized P&L up to and including this date. */
  cumulativePnl: number
  /** Number of CLOSED trades that closed on this date. */
  tradeCount: number
}

/** P&L series plus chart-enrichment fields merged by the caller. */
export interface PnlChartPoint extends PnlSeriesPoint {
  /** Real account balance at this date (startingBalance + flows + realized P&L). */
  equity: number | null
  /** Canonical daily trading return % for this date (account/aggregate series), if available. */
  returnPct: number | null
}

/**
 * Build the cumulative realized P&L series from a list of trades.
 * Closed trades are grouped by close date, summed, and accumulated in
 * chronological order. Returns an empty array when there are no closed trades.
 */
export function buildCumulativePnlSeries(trades: Trade[]): PnlSeriesPoint[] {
  const byDay = groupClosedTradesByCloseDate(trades)
  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b))
  const points: PnlSeriesPoint[] = []
  let cumulative = 0
  for (const date of days) {
    const closedThatDay = byDay.get(date) || []
    const dailyPnl = sumClosedTradePnl(closedThatDay)
    cumulative += dailyPnl
    points.push({ date, dailyPnl, cumulativePnl: cumulative, tradeCount: closedThatDay.length })
  }
  return points
}

/**
 * Real account-balance (equity) curve at each P&L-series date.
 *
 * equity(date) = startingBalance + cumulative realized P&L to date + net external
 * cash flows (adjustments) dated ON OR BEFORE that date. This matches the
 * canonical account-balance definition (`startingBalance + deposits - withdrawals
 * + realized P&L`) used by `getAccountBalance` / `calculateScopeAdjustedBalance`.
 *
 * `adjustments` must already be scope-filtered to the same accounts as the
 * series trades, and `startingBalance` is the scoped starting capital
 * (single account's balance, or the sum across scoped accounts for All Accounts).
 */
export function buildEquitySeries(
  points: PnlSeriesPoint[],
  adjustments: BalanceAdjustment[],
  startingBalance: number,
): Map<string, number> {
  const flowByDate = (adjustments || [])
    .filter((adjustment) => adjustment && DATE_KEY_PATTERN.test(adjustment.date))
    .map((adjustment) => {
      const amount = Number(adjustment.amount)
      const delta = isFiniteNumber(amount) ? amount : 0
      return { date: adjustment.date, delta: adjustment.type === "add" ? delta : -delta }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const equity = new Map<string, number>()
  let flowIndex = 0
  let cumulativeFlows = 0
  const base = isFiniteNumber(startingBalance) ? startingBalance : 0

  for (const point of points) {
    while (flowIndex < flowByDate.length && flowByDate[flowIndex].date <= point.date) {
      cumulativeFlows += flowByDate[flowIndex].delta
      flowIndex += 1
    }
    equity.set(point.date, base + point.cumulativePnl + cumulativeFlows)
  }
  return equity
}

/** Merged chart-ready points: P&L series + equity + canonical daily return %. */
export function buildPnlChartPoints(input: {
  trades: Trade[]
  adjustments: BalanceAdjustment[]
  startingBalance: number
  returnByDate?: Map<string, number | null>
}): PnlChartPoint[] {
  const series = buildCumulativePnlSeries(input.trades)
  const equityByDate = buildEquitySeries(series, input.adjustments, input.startingBalance)
  return series.map((point) => ({
    ...point,
    equity: equityByDate.get(point.date) ?? null,
    returnPct: input.returnByDate?.get(point.date) ?? null,
  }))
}
