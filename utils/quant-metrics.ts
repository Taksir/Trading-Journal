import type { BalanceAdjustment, Settings, Trade } from "@/types/trade"

/**
 * Quantitative trading-performance metrics.
 *
 * All functions here are pure, deterministic and side-effect free.
 * The only type imports are erased at runtime (Node type stripping / bundlers),
 * so this module can be unit tested with plain scripts.
 *
 * Notes on semantics:
 * - Only CLOSED trades participate in the quantitative metrics. A trade is
 *   closed when it has a close date (`endDate`), which is the schema's canonical
 *   open/closed signal (see `types/trade.ts`). See `isTradeClosed`.
 * - Chronological order is the CLOSE time: `endDate + endTime`.
 * - Deposits/withdrawals (balance adjustments) are NOT included in the trading
 *   equity curve, drawdown, or daily returns. Only `settings.accountBalance`
 *   (the starting balance) plus realized trading P&L participate, so manual
 *   balance changes never inflate or deflate strategy performance.
 * - Trade outcome is classified purely by NET pnl: pnl > 0 => win,
 *   pnl < 0 => loss, pnl === 0 => breakeven.
 * - None of these functions mutate the input `trades` array; they always work on
 *   filtered/copied arrays.
 */

export interface QuantMetrics {
  /** Number of CLOSED trades. */
  totalTrades: number
  /** Number of OPEN (not yet closed) trades. */
  openTrades: number
  winningTrades: number
  losingTrades: number
  breakevenTrades: number

  winRate: number | null

  avgWinPct: number | null
  avgLossPct: number | null

  avgWinningR: number | null
  avgLosingR: number | null
  payoffRatio: number | null

  expectancyR: number | null
  profitFactor: number | null

  sharpeRatio: number | null
  sortinoRatio: number | null

  maxDrawdownPct: number | null
  maxDrawdownAmount: number

  maxConsecutiveLosses: number
  currentConsecutiveLosses: number

  dailyObservationCount: number
}

export interface DailyReturnSeries {
  days: string[]
  returns: number[]
}

export interface LossStreaks {
  maxConsecutiveLosses: number
  currentConsecutiveLosses: number
}

export interface DrawdownResult {
  /** Most negative drawdown in percent (<= 0), or null when not computable. */
  maxDrawdownPct: number | null
  /** Most negative drawdown in dollars (<= 0). */
  maxDrawdownAmount: number
}

/**
 * Account-aware options for `calculateQuantMetrics`.
 *
 * Trade-level metrics always operate on the `trades` passed in (callers pass
 * already scope-filtered trades). The equity-level metrics (daily returns,
 * Sharpe, Sortino, drawdown) use the supplied starting balance / precomputed
 * series so the correct selected-account context is used instead of one global
 * `settings.accountBalance`. When `dailyReturns`/`drawdown` are omitted they
 * are derived from the closed trades and `startingBalance` exactly as before.
 */
export interface QuantMetricsOptions {
  startingBalance: number
  dailyReturns?: DailyReturnSeries
  drawdown?: DrawdownResult
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safePnl(trade: Trade): number {
  const value = Number(trade.pnl)
  return isFiniteNumber(value) ? value : 0
}

/**
 * Canonical closed/open rule: a trade is CLOSED when it has a close date
 * (`endDate`). This matches the schema comment in `types/trade.ts`
 * ("Optional for trades that are still open"). Everything else (exitPrice,
 * pnl, outcome) is NOT a reliable signal: breakeven trades legitimately have
 * pnl === 0, and pnl may be a placeholder on open positions.
 */
export function isTradeClosed(trade: Trade): boolean {
  return Boolean(trade && typeof trade.endDate === "string" && trade.endDate.length > 0)
}

function parseTimestamp(date: string | undefined, time: string | undefined): number | null {
  if (!date || !DATE_KEY_PATTERN.test(date)) return null
  const [, year, month, day] = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  const parts = (time || "00:00").split(":").map(Number)
  const hours = isFiniteNumber(parts[0]) ? parts[0] : 0
  const minutes = isFiniteNumber(parts[1]) ? parts[1] : 0
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), hours, minutes)
  return Number.isNaN(timestamp) ? null : timestamp
}

/** Close timestamp in ms (UTC). Falls back to the open date/time when no close exists. */
export function getCloseTimestamp(trade: Trade): number | null {
  return trade.endDate
    ? parseTimestamp(trade.endDate, trade.endTime)
    : parseTimestamp(trade.date, trade.time)
}

/** Close date key `YYYY-MM-DD`. Falls back to the open date when no close exists. */
export function getCloseDateKey(trade: Trade): string {
  return trade.endDate || trade.date
}

/**
 * Net trade return as a percent of the position notional (abs(entryPrice * size)).
 * Because `pnl` is net of fees, this return is fee-aware. Returns null when the
 * notional is missing, zero or non-finite.
 */
export function calculateTradeReturnPct(trade: Trade): number | null {
  const entry = Number(trade.entryPrice)
  const size = Number(trade.positionSize)
  if (!isFiniteNumber(entry) || !isFiniteNumber(size)) return null
  const notional = Math.abs(entry * size)
  if (notional <= 0) return null
  return (safePnl(trade) / notional) * 100
}

/**
 * Net R per trade: pnl relative to ideal risk, falling back to actual risk, then
 * to the stored r-multiple. Recomputed from pnl + risk fields so stale `expectedR`
 * values are never trusted.
 */
export function calculateNetR(trade: Trade): number {
  const pnl = safePnl(trade)
  const ideal = Number(trade.idealRiskAmount)
  const actual = Number(trade.actualRiskAmount)
  if (isFiniteNumber(ideal) && ideal > 0) return pnl / ideal
  if (isFiniteNumber(actual) && actual > 0) return pnl / actual
  const r = Number(trade.rMultiple)
  return isFiniteNumber(r) ? r : 0
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/** Sample standard deviation (denominator n - 1). Null when fewer than 2 values. */
export function sampleStdDev(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const m = mean(values)
  if (m === null) return null
  let sum = 0
  for (const value of values) {
    const d = value - m
    sum += d * d
  }
  return Math.sqrt(sum / (n - 1))
}

/**
 * Builds a daily realized-P&L return series from the starting account balance.
 * Weekdays (Mon-Fri) between the first and last close date are included, so days
 * without a realized trade contribute a 0% return. Weekends are excluded.
 */
export function calculateDailyReturns(trades: Trade[], startingBalance: number): DailyReturnSeries {
  if (!isFiniteNumber(startingBalance) || startingBalance <= 0) {
    return { days: [], returns: [] }
  }

  const daily = new Map<string, number>()
  let first: string | null = null
  let last: string | null = null

  for (const trade of trades.filter(isTradeClosed)) {
    const key = getCloseDateKey(trade)
    if (!DATE_KEY_PATTERN.test(key)) continue
    daily.set(key, (daily.get(key) || 0) + safePnl(trade))
    if (first === null || key < first) first = key
    if (last === null || key > last) last = key
  }

  if (!first || !last) return { days: [], returns: [] }

  const days: string[] = []
  const returns: number[] = []
  let equity = startingBalance
  const cursor = new Date(`${first}T00:00:00Z`)
  const end = new Date(`${last}T00:00:00Z`)

  while (cursor.getTime() <= end.getTime()) {
    const dayOfWeek = cursor.getUTCDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const key = cursor.toISOString().slice(0, 10)
      days.push(key)
      const pnl = daily.get(key) || 0
      if (equity > 0) {
        returns.push(pnl / equity)
        equity += pnl
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return { days, returns }
}

/**
 * Maximum drawdown on the trading equity curve (starting balance + realized pnl,
 * ordered by close time). Drawdown % is relative to the running equity peak; it is
 * null when the peak is not positive (e.g. starting balance <= 0).
 */
export function calculateDrawdown(trades: Trade[], startingBalance: number): DrawdownResult {
  const sorted = trades
    .filter(isTradeClosed)
    .map((trade) => ({ trade, timestamp: getCloseTimestamp(trade) }))
    .filter((entry): entry is { trade: Trade; timestamp: number } => entry.timestamp !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  let equity = isFiniteNumber(startingBalance) ? startingBalance : 0
  let peak = equity
  let maxPct: number | null = null
  let maxAmount = 0

  for (const { trade } of sorted) {
    equity += safePnl(trade)
    if (equity > peak) {
      peak = equity
    } else {
      const drawdown = equity - peak
      if (drawdown < maxAmount) maxAmount = drawdown
      // A meaningful percentage requires a positive peak AND a positive start,
      // otherwise the denominator (peak) is derived entirely from unrealized gains.
      if (startingBalance > 0 && peak > 0) {
        const pct = (drawdown / peak) * 100
        if (maxPct === null || pct < maxPct) maxPct = pct
      }
    }
  }

  return { maxDrawdownPct: maxPct, maxDrawdownAmount: maxAmount }
}

/**
 * Largest and current streaks of consecutive losing trades (pnl < 0).
 * A breakeven resets the loss streak.
 */
export function calculateLossStreaks(trades: Trade[]): LossStreaks {
  const sorted = trades
    .filter(isTradeClosed)
    .map((trade) => ({ trade, timestamp: getCloseTimestamp(trade) }))
    .filter((entry): entry is { trade: Trade; timestamp: number } => entry.timestamp !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  let current = 0
  let max = 0

  for (const { trade } of sorted) {
    if (safePnl(trade) < 0) {
      current += 1
      if (current > max) max = current
    } else {
      current = 0
    }
  }

  return { maxConsecutiveLosses: max, currentConsecutiveLosses: current }
}

/** Sum of net trading P&L across all trades. */
export function calculateNetTradingPnL(trades: Trade[]): number {
  return trades.reduce((sum, trade) => sum + safePnl(trade), 0)
}

export function calculateBalanceAdjustmentTotal(adjustments: BalanceAdjustment[] | undefined): number {
  if (!Array.isArray(adjustments)) return 0
  return adjustments.reduce((sum, adjustment) => {
    if (!adjustment) return sum
    const amount = Number(adjustment.amount)
    if (!isFiniteNumber(amount)) return sum
    return sum + (adjustment.type === "add" ? amount : -amount)
  }, 0)
}

/**
 * Adjusted account balance: starting balance + deposits/withdrawals + net trading P&L.
 * Deposits are intentionally included here (this is the real account value) but are
 * NOT part of the trading equity curve used for drawdown/Sharpe/Sortino.
 */
export function calculateAdjustedAccountBalance(
  trades: Trade[],
  settings: Settings,
  adjustments?: BalanceAdjustment[],
): number {
  const base = isFiniteNumber(settings?.accountBalance) ? settings.accountBalance : 0
  return base + calculateBalanceAdjustmentTotal(adjustments) + calculateNetTradingPnL(trades)
}

export function calculateQuantMetrics(trades: Trade[], options: QuantMetricsOptions): QuantMetrics {
  const closedTrades = trades.filter(isTradeClosed)
  const openTrades = trades.length - closedTrades.length
  const totalTrades = closedTrades.length

  let winningTrades = 0
  let losingTrades = 0
  let breakevenTrades = 0
  let grossProfit = 0
  let grossLoss = 0

  const winReturns: number[] = []
  const lossReturns: number[] = []
  const winR: number[] = []
  const lossR: number[] = []
  const allR: number[] = []

  for (const trade of closedTrades) {
    const pnl = safePnl(trade)
    const returnPct = calculateTradeReturnPct(trade)
    const netR = calculateNetR(trade)
    allR.push(netR)

    if (pnl > 0) {
      winningTrades += 1
      grossProfit += pnl
      if (returnPct !== null) winReturns.push(returnPct)
      winR.push(netR)
    } else if (pnl < 0) {
      losingTrades += 1
      grossLoss += -pnl
      if (returnPct !== null) lossReturns.push(returnPct)
      lossR.push(netR)
    } else {
      breakevenTrades += 1
    }
  }

  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : null
  const avgWinPct = mean(winReturns)
  const avgLossPct = mean(lossReturns)
  const avgWinningR = mean(winR)
  const avgLosingR = mean(lossR)

  let payoffRatio: number | null
  if (winningTrades > 0 && losingTrades === 0) {
    payoffRatio = Number.POSITIVE_INFINITY
  } else if (avgWinningR !== null && avgLosingR !== null && avgLosingR !== 0) {
    payoffRatio = avgWinningR / Math.abs(avgLosingR)
  } else {
    payoffRatio = null
  }

  const expectancyR = mean(allR)
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null

  const startingBalance = isFiniteNumber(options?.startingBalance) ? options.startingBalance : 0
  const { days, returns } = options?.dailyReturns ?? calculateDailyReturns(closedTrades, startingBalance)
  const dailyObservationCount = days.length

  let sharpeRatio: number | null = null
  let sortinoRatio: number | null = null

  const m = mean(returns)
  const sd = sampleStdDev(returns)
  if (m !== null && sd !== null && sd > 0 && returns.length >= 2) {
    sharpeRatio = (m / sd) * Math.sqrt(252)
  }
  if (m !== null && returns.length >= 2) {
    let downsideSum = 0
    for (const r of returns) {
      if (r < 0) downsideSum += r * r
    }
    const downsideDeviation = Math.sqrt(downsideSum / returns.length)
    if (downsideDeviation > 0) {
      sortinoRatio = (m / downsideDeviation) * Math.sqrt(252)
    }
  }

  const drawdownResult = options?.drawdown ?? calculateDrawdown(closedTrades, startingBalance)
  const { maxDrawdownPct, maxDrawdownAmount } = drawdownResult
  const { maxConsecutiveLosses, currentConsecutiveLosses } = calculateLossStreaks(closedTrades)

  return {
    totalTrades,
    openTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRate,
    avgWinPct,
    avgLossPct,
    avgWinningR,
    avgLosingR,
    payoffRatio,
    expectancyR,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownPct,
    maxDrawdownAmount,
    maxConsecutiveLosses,
    currentConsecutiveLosses,
    dailyObservationCount,
  }
}
