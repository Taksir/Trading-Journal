import type { AccountScope, TradingAccount } from "@/types/account"
import { scopeAccounts } from "./account-scope.ts"
import type { BalanceAdjustment, Trade } from "@/types/trade"
import {
  calculateDailyReturns,
  calculateDrawdown,
  calculateQuantMetrics,
  getCloseDateKey,
  getCloseTimestamp,
  isTradeClosed,
  type DailyReturnSeries,
  type DrawdownResult,
  type QuantMetrics,
} from "./quant-metrics.ts"

/**
 * Account-scoped analytics.
 *
 * Conventions (documented, deterministic):
 * - TRADING EQUITY CURVE (used for daily returns, Sharpe, Sortino, drawdown):
 *   `startingBalance + cumulative realized P&L`. Deposits/withdrawals are
 *   external cash flows and are EXCLUDED, so cash flows never masquerade as
 *   trading performance. This preserves the pre-account verified semantics.
 * - REAL ACCOUNT BALANCE (shown in KPIs / selector):
 *   `startingBalance + deposits - withdrawals + realized P&L`.
 * - An external cash flow dated on day D is recorded on day D (see
 *   `netAdjustments`) and affects the real account balance immediately, but it
 *   only enters the trading-return denominator from the NEXT day onward — a
 *   same-day deposit never inflates that day's trading return.
 * - Daily trading return % = realized trading P&L / trading equity at start of day.
 * - Aggregate (All Accounts) daily return is CAPITAL-WEIGHTED:
 *   aggregateReturn = totalRealizedPnl / aggregateTradingEquityStart. It is NOT
 *   the simple average of per-account percentage returns.
 * - An account enters the aggregate series on its EFFECTIVE PARTICIPATION
 *   START: a valid explicit `startingDate` even with no trades (idle capital is
 *   portfolio capital); the first close date only when no valid `startingDate`
 *   exists; the first close when `startingDate` is later than real history
 *   (inconsistent data — never drop realized performance). Weekdays with no
 *   activity contribute a 0% return.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safePnl(trade: Trade): number {
  const value = Number(trade.pnl)
  return isFiniteNumber(value) ? value : 0
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

function iterateWeekdays(first: string, last: string): string[] {
  const days: string[] = []
  const cursor = new Date(`${first}T00:00:00Z`)
  const end = new Date(`${last}T00:00:00Z`)
  while (cursor.getTime() <= end.getTime()) {
    if (isWeekday(cursor)) {
      days.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

// ---------------------------------------------------------------- filtering

export function filterTradesByScope(trades: Trade[], scope: AccountScope): Trade[] {
  if (scope.kind === "all") return trades
  const ids = new Set(scope.accountIds)
  return trades.filter((trade) => trade.accountId !== undefined && ids.has(trade.accountId))
}

export function filterAdjustmentsByScope(adjustments: BalanceAdjustment[], scope: AccountScope): BalanceAdjustment[] {
  if (scope.kind === "all") return adjustments
  const ids = new Set(scope.accountIds)
  return adjustments.filter((adjustment) => adjustment.accountId !== undefined && ids.has(adjustment.accountId))
}

export function getAccountName(accounts: TradingAccount[], accountId: string | undefined | null): string {
  if (!accountId) return "Unknown"
  const account = accounts.find((candidate) => candidate.id === accountId)
  return account ? account.name : "Unknown"
}

// ------------------------------------------------------ per-account balance

export function getAccountAdjustmentTotal(accountId: string, adjustments: BalanceAdjustment[] | undefined): number {
  if (!Array.isArray(adjustments)) return 0
  return adjustments.reduce((sum, adjustment) => {
    if (!adjustment || adjustment.accountId !== accountId) return sum
    const amount = Number(adjustment.amount)
    if (!isFiniteNumber(amount)) return sum
    return sum + (adjustment.type === "add" ? amount : -amount)
  }, 0)
}

/** Realized net trading P&L for an account. Open trades excluded (realized only). */
export function getAccountNetTradingPnL(accountId: string, trades: Trade[]): number {
  return (trades || []).reduce((sum, trade) => {
    if (!trade || trade.accountId !== accountId || !isTradeClosed(trade)) return sum
    return sum + safePnl(trade)
  }, 0)
}

/** Real account value: startingBalance + deposits/withdrawals + realized P&L. */
export function getAccountBalance(account: TradingAccount, trades: Trade[], adjustments: BalanceAdjustment[]): number {
  const base = isFiniteNumber(account?.startingBalance) ? account.startingBalance : 0
  return base + getAccountAdjustmentTotal(account.id, adjustments) + getAccountNetTradingPnL(account.id, trades)
}

/** Sum of each in-scope account's real balance. Never double-counts. */
export function calculateScopeAdjustedBalance(
  scope: AccountScope,
  accounts: TradingAccount[],
  trades: Trade[],
  adjustments: BalanceAdjustment[],
): number {
  return scopeAccounts(scope, accounts).reduce((sum, account) => sum + getAccountBalance(account, trades, adjustments), 0)
}

// ------------------------------------------------- daily equity series

export interface DailyEquityPoint {
  date: string
  /** Trading equity at start of day (starting balance + prior realized P&L, flows excluded). */
  tradingEquityStart: number
  /** Real account value at start of day (includes prior external flows). */
  accountBalanceStart: number
  realizedPnl: number
  /** External cash flow on this day (add - subtract). Informational only. */
  netAdjustments: number
  /** Trading return % = realizedPnl / tradingEquityStart * 100. */
  returnPct: number
  /** Real account value at end of day. */
  accountBalanceEnd: number
}

export interface AccountDailySeries {
  points: DailyEquityPoint[]
  first: string | null
  last: string | null
}

interface DayAggregate {
  pnl: Map<string, number>
  first: string | null
  last: string | null
}

function buildDayAggregates(accountId: string, trades: Trade[], adjustments: BalanceAdjustment[]): {
  pnlByDay: Map<string, number>
  first: string | null
  last: string | null
} {
  const pnlByDay = new Map<string, number>()
  let first: string | null = null
  let last: string | null = null

  for (const trade of trades) {
    if (!trade || trade.accountId !== accountId || !isTradeClosed(trade)) continue
    const key = getCloseDateKey(trade)
    if (!DATE_KEY_PATTERN.test(key)) continue
    pnlByDay.set(key, (pnlByDay.get(key) || 0) + safePnl(trade))
    if (first === null || key < first) first = key
    if (last === null || key > last) last = key
  }

  return { pnlByDay, first, last }
}

function netAdjustmentsByDay(accountId: string, adjustments: BalanceAdjustment[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const adjustment of adjustments || []) {
    if (!adjustment || adjustment.accountId !== accountId) continue
    const key = adjustment.date
    if (!DATE_KEY_PATTERN.test(key)) continue
    const delta = adjustment.type === "add" ? adjustment.amount : -adjustment.amount
    map.set(key, (map.get(key) || 0) + delta)
  }
  return map
}

/**
 * Deterministic effective participation start for an account's trading-equity
 * series.
 *
 * Rule (documented, tested):
 * - If the account has a VALID explicit `startingDate`, its capital participates
 *   from that date — even on days/months with no trades. Idle capital is still
 *   portfolio capital, so it must be in the aggregate return denominator.
 * - If a closed trade exists BEFORE the configured `startingDate`, the data is
 *   inconsistent (a startingDate later than real history). The effective start
 *   is pulled back to the first close so no realized performance is dropped.
 * - If there is no valid `startingDate`, fall back to the first close date.
 *
 * `firstClose` is the earliest closed-trade close date (or null when the
 * account has no closed trades).
 */
function participationStart(account: TradingAccount, firstClose: string | null): string | null {
  const hasStartingDate = Boolean(account.startingDate && DATE_KEY_PATTERN.test(account.startingDate as string))
  if (hasStartingDate && firstClose !== null) {
    return firstClose < (account.startingDate as string) ? firstClose : (account.startingDate as string)
  }
  if (hasStartingDate) {
    return account.startingDate as string
  }
  return firstClose
}

function hasClosedTrades(accountId: string, trades: Trade[]): boolean {
  return trades.some((trade) => trade.accountId === accountId && isTradeClosed(trade) && DATE_KEY_PATTERN.test(getCloseDateKey(trade)))
}

/** Daily equity table for a single account. See module docs for conventions. */
export function buildAccountDailySeries(
  account: TradingAccount,
  trades: Trade[],
  adjustments: BalanceAdjustment[],
): AccountDailySeries {
  const { pnlByDay, first, last } = buildDayAggregates(account.id, trades, adjustments)
  if (!first || !last) return { points: [], first: null, last: null }

  const start = participationStart(account, first)
  if (!start) return { points: [], first: null, last: null }

  const adjustmentByDay = netAdjustmentsByDay(account.id, adjustments)
  // Start the curve at the effective participation start so idle capital
  // present before the first close still appears in the trading-equity
  // denominator (it contributes 0% until its first realized trade).
  const days = iterateWeekdays(start, last)
  const points: DailyEquityPoint[] = []

  let cumulativePnl = 0
  let cumulativeAdjustments = 0

  for (const date of days) {
    const realizedPnl = pnlByDay.get(date) || 0
    const netAdjustments = adjustmentByDay.get(date) || 0
    const tradingEquityStart = account.startingBalance + cumulativePnl
    const accountBalanceStart = account.startingBalance + cumulativeAdjustments + cumulativePnl
    const returnPct = tradingEquityStart > 0 ? (realizedPnl / tradingEquityStart) * 100 : 0
    const accountBalanceEnd = accountBalanceStart + realizedPnl + netAdjustments

    points.push({
      date,
      tradingEquityStart,
      accountBalanceStart,
      realizedPnl,
      netAdjustments,
      returnPct,
      accountBalanceEnd,
    })

    cumulativePnl += realizedPnl
    cumulativeAdjustments += netAdjustments
  }

  return { points, first: start, last }
}

// ------------------------------------------------- aggregate daily series

interface AccountSeriesWindow {
  account: TradingAccount
  points: DailyEquityPoint[]
  byDate: Map<string, DailyEquityPoint>
}

function buildAccountWindows(accounts: TradingAccount[], trades: Trade[], adjustments: BalanceAdjustment[]) {
  return accounts
    .map((account) => {
      const series = buildAccountDailySeries(account, trades, adjustments)
      return { account, series }
    })
    .filter((entry) => entry.series.first !== null && entry.series.last !== null)
    .map((entry) => {
      const byDate = new Map<string, DailyEquityPoint>()
      for (const point of entry.series.points) byDate.set(point.date, point)
      return { account: entry.account, points: entry.series.points, byDate }
    })
}

/**
 * Capital-weighted aggregate daily series for a set of accounts.
 *
 * aggregateReturn = totalRealizedPnl / aggregateTradingEquityStart for the day,
 * where aggregateTradingEquityStart sums each participating account's trading
 * equity at the start of that day.
 *
 * Participation rules (documented, tested):
 * - An account with a valid `startingDate` participates from that date even if
 *   it has no trades yet — idle capital is still portfolio capital and belongs
 *   in the denominator.
 * - An account without a valid `startingDate` participates from its first
 *   close; an account with a `startingDate` later than a historical close
 *   participates from that close (inconsistent data, never drop history).
 * - Idle-only accounts (no closed trades) with a valid `startingDate` and a
 *   finite starting balance contribute flat capital from their start date
 *   through the aggregate window; without a `startingDate` there is no
 *   deterministic participation point, so they are excluded rather than
 *   fabricated.
 * - The daily-return series is anchored to trading activity (accounts with
 *   closed trades); a day with no activity anywhere contributes 0%.
 */
export function buildAggregateDailySeries(
  accounts: TradingAccount[],
  trades: Trade[],
  adjustments: BalanceAdjustment[],
): AccountDailySeries {
  const windows = buildAccountWindows(accounts, trades, adjustments)

  let globalFirst: string | null = null
  let globalLast: string | null = null
  for (const window of windows) {
    const firstPoint = window.points[0]
    const lastPoint = window.points[window.points.length - 1]
    if (!firstPoint || !lastPoint) continue
    if (globalFirst === null || firstPoint.date < globalFirst) globalFirst = firstPoint.date
    if (globalLast === null || lastPoint.date > globalLast) globalLast = lastPoint.date
  }

  if (!globalFirst || !globalLast) return { points: [], first: null, last: null }

  // Idle-only accounts (no closed trades anywhere) that have already started.
  const idleAccounts = accounts.filter(
    (account) =>
      !hasClosedTrades(account.id, trades) &&
      Boolean(account.startingDate && DATE_KEY_PATTERN.test(account.startingDate as string)) &&
      isFiniteNumber(account.startingBalance),
  )
  const idleCumulativeFlow = new Map<string, number>()

  const days = iterateWeekdays(globalFirst, globalLast)
  const points: DailyEquityPoint[] = []

  for (const date of days) {
    let totalPnl = 0
    let totalTradingEquity = 0
    let totalAdjustments = 0
    let totalBalanceEnd = 0

    for (const window of windows) {
      const point = window.byDate.get(date)
      if (!point) continue
      totalPnl += point.realizedPnl
      totalTradingEquity += point.tradingEquityStart
      totalAdjustments += point.netAdjustments
      totalBalanceEnd += point.accountBalanceEnd
    }

    for (const account of idleAccounts) {
      if ((account.startingDate as string) > date) continue
      const flow = netAdjustmentsByDay(account.id, adjustments).get(date) || 0
      const cumulative = (idleCumulativeFlow.get(account.id) || 0) + flow
      idleCumulativeFlow.set(account.id, cumulative)
      totalTradingEquity += account.startingBalance
      totalAdjustments += flow
      totalBalanceEnd += account.startingBalance + cumulative
    }

    const returnPct = totalTradingEquity > 0 ? (totalPnl / totalTradingEquity) * 100 : 0

    points.push({
      date,
      tradingEquityStart: totalTradingEquity,
      accountBalanceStart: totalBalanceEnd - totalPnl - totalAdjustments,
      realizedPnl: totalPnl,
      netAdjustments: totalAdjustments,
      returnPct,
      accountBalanceEnd: totalBalanceEnd,
    })
  }

  return { points, first: globalFirst, last: globalLast }
}

export function aggregateSeriesToDailyReturns(series: AccountDailySeries): DailyReturnSeries {
  return {
    days: series.points.map((point) => point.date),
    returns: series.points.map((point) => point.returnPct / 100),
  }
}

// ----------------------------------------------------------------- drawdown

/**
 * Drawdown over the merged trading-equity curves of multiple accounts.
 * Each account's curve is `startingBalance + cumulative realized P&L` (no
 * external flows), and its starting capital enters the combined curve at its
 * EFFECTIVE PARTICIPATION START (see `participationStart`) — so an account
 * that starts later never dilutes the drawdown of earlier portfolio events.
 * Events are merged in global close-time order; a participation "start" is
 * ordered before same-day realized P&L so capital is present before its P&L.
 */
export function calculateAggregateDrawdown(
  accounts: TradingAccount[],
  trades: Trade[],
  adjustments: BalanceAdjustment[],
): DrawdownResult {
  void adjustments
  const events: { timestamp: number; kind: "start" | "pnl"; accountId: string; amount: number }[] = []

  for (const account of accounts) {
    let accountFirstClose: string | null = null
    for (const trade of trades) {
      if (!trade || trade.accountId !== account.id || !isTradeClosed(trade)) continue
      const key = getCloseDateKey(trade)
      if (!DATE_KEY_PATTERN.test(key)) continue
      if (accountFirstClose === null || key < accountFirstClose) accountFirstClose = key
      const timestamp = getCloseTimestamp(trade)
      if (timestamp === null) continue
      events.push({ timestamp, kind: "pnl", accountId: account.id, amount: safePnl(trade) })
    }
    const start = participationStart(account, accountFirstClose)
    if (start) {
      const base = isFiniteNumber(account.startingBalance) ? account.startingBalance : 0
      events.push({
        timestamp: new Date(`${start}T00:00:00Z`).getTime(),
        kind: "start",
        accountId: account.id,
        amount: base,
      })
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp || (a.kind === "start" ? -1 : 1))

  const equityByAccount = new Map<string, number>()
  let combined = 0
  let peak = 0
  let maxPct: number | null = null
  let maxAmount = 0
  const anyAccountTraded = events.some((event) => event.kind === "pnl")

  for (const event of events) {
    const previous = equityByAccount.get(event.accountId) || 0
    const updated = previous + event.amount
    equityByAccount.set(event.accountId, updated)
    combined = combined - previous + updated

    if (combined > peak) {
      peak = combined
    } else {
      const drawdown = combined - peak
      if (drawdown < maxAmount) maxAmount = drawdown
      if (peak > 0 && anyAccountTraded) {
        const pct = (drawdown / peak) * 100
        if (maxPct === null || pct < maxPct) maxPct = pct
      }
    }
  }

  return { maxDrawdownPct: maxPct, maxDrawdownAmount: maxAmount }
}

// ------------------------------------------------------- scope quant metrics

export interface ScopeMetricsInput {
  trades: Trade[]
  scope: AccountScope
  accounts: TradingAccount[]
  adjustments?: BalanceAdjustment[]
}

/**
 * Account-aware quantitative metrics.
 *
 * Trade-level metrics (counts, win rate, avg win/loss %, payoff, expectancy,
 * profit factor, streaks) operate on the scope-filtered CLOSED trades.
 *
 * Equity-level metrics (daily returns, Sharpe, Sortino, drawdown, balance) use
 * the correct selected-account context:
 * - single account: that account's starting balance / equity curve;
 * - all / multiple: capital-weighted aggregate daily series + merged drawdown.
 */
export function calculateScopeQuantMetrics(input: ScopeMetricsInput): QuantMetrics {
  const { trades, scope, accounts, adjustments = [] } = input
  const filtered = filterTradesByScope(trades, scope)
  const scopedAccounts = scopeAccounts(scope, accounts)

  if (scopedAccounts.length === 1) {
    const account = scopedAccounts[0]
    const startingBalance = isFiniteNumber(account.startingBalance) ? account.startingBalance : 0
    const dailyReturns = calculateDailyReturns(filtered, startingBalance)
    const drawdown = calculateDrawdown(filtered, startingBalance)
    return calculateQuantMetrics(filtered, { startingBalance, dailyReturns, drawdown })
  }

  const aggregate = buildAggregateDailySeries(scopedAccounts, trades, adjustments)
  const dailyReturns = aggregateSeriesToDailyReturns(aggregate)
  const startingBalance = scopedAccounts.reduce((sum, account) => {
    return sum + (isFiniteNumber(account.startingBalance) ? account.startingBalance : 0)
  }, 0)
  const drawdown = calculateAggregateDrawdown(scopedAccounts, filtered, adjustments)

  return calculateQuantMetrics(filtered, { startingBalance, dailyReturns, drawdown })
}
