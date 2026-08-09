/**
 * Deterministic tests for the cumulative realized P&L series:
 * - close-time ordering (daily aggregation, chronological)
 * - open trades excluded, breakevens contribute $0
 * - account scope / All Accounts aggregation (sum, not average)
 * - original trade array never mutated
 * - equity (real account balance) curve and merged chart points
 *
 * Run with: npm run test:pnl
 */
import type { BalanceAdjustment, Trade } from "../types/trade.ts"
import { buildCumulativePnlSeries, buildEquitySeries, buildPnlChartPoints } from "../utils/pnl-series.ts"
import { filterTradesByScope, type DailyEquityPoint } from "../utils/account-analytics.ts"
import { buildAccountDailySeries, buildAggregateDailySeries } from "../utils/account-analytics.ts"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

function assertClose(actual: number, expected: number, label: string, eps = 0.01): void {
  if (Math.abs(actual - expected) <= eps) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label} (got ${actual}, expected ${expected})`)
  }
}

let sequence = 0
function trade(overrides: Partial<Trade> = {}): Trade {
  sequence += 1
  return {
    id: overrides.id || `trade-${sequence}`,
    date: "2026-01-01",
    time: "09:00",
    endDate: "2026-01-02",
    endTime: "15:00",
    asset: "TEST",
    tradeType: "Long",
    entryPrice: 100,
    exitPrice: 110,
    stopLoss: 95,
    takeProfit: 0,
    positionSize: 10,
    riskPercent: 0,
    rMultiple: 0,
    pnl: 100,
    fee: 0,
    riskAmount: 0,
    idealRiskAmount: 0,
    actualRiskAmount: 0,
    riskDeviation: 0,
    expectedR: 0,
    isOverRisked: false,
    isUnderRisked: false,
    duration: "1d",
    system: "",
    timeframe: "",
    notes: "",
    tags: [],
    outcome: "Win",
    grade: "A",
    session: "London",
    dayOfWeek: "Friday",
    ...overrides,
  }
}

function adjustment(overrides: Partial<BalanceAdjustment> = {}): BalanceAdjustment {
  return {
    id: `adj-${sequence}`,
    amount: 500,
    reason: "Deposit",
    type: "add",
    date: "2026-01-04",
    time: "00:00",
    ...overrides,
  }
}

// Deterministic request fixture (close Jan 2/3/3/5).
const t1 = trade({ id: "t1", date: "2026-01-01", endDate: "2026-01-02", pnl: 500, asset: "AAA", accountId: "acc-a" })
const t2 = trade({ id: "t2", date: "2026-01-01", endDate: "2026-01-03", pnl: -200, asset: "BBB", accountId: "acc-a" })
const t3 = trade({ id: "t3", date: "2026-01-02", endDate: "2026-01-03", pnl: 100, asset: "CCC", accountId: "acc-a" })
const t4 = trade({ id: "t4", date: "2026-01-04", endDate: "2026-01-05", pnl: 900, asset: "DDD", accountId: "acc-b" })

// ============================================================ DAILY SERIES

console.log("--- buildCumulativePnlSeries ---")
{
  // Shuffled input: ordering must be by close date, not input order.
  const shuffled = [t4, t1, t3, t2]
  const series = buildCumulativePnlSeries(shuffled)

  assert(series.length === 3, "three distinct close days")
  assert(series[0].date === "2026-01-02", "first point is the earliest close date (Jan 2)")
  assert(series[1].date === "2026-01-03", "second point is Jan 3")
  assert(series[2].date === "2026-01-05", "third point is Jan 5")

  assertClose(series[0].dailyPnl, 500, "Jan 2 daily +500")
  assertClose(series[0].cumulativePnl, 500, "Jan 2 cumulative +500")
  assert(series[0].tradeCount === 1, "Jan 2 trades closed = 1")

  assertClose(series[1].dailyPnl, -100, "Jan 3 daily -100 (-200 + 100 same-day aggregation)")
  assertClose(series[1].cumulativePnl, 400, "Jan 3 cumulative +400")
  assert(series[1].tradeCount === 2, "Jan 3 trades closed = 2")

  assertClose(series[2].dailyPnl, 900, "Jan 5 daily +900")
  assertClose(series[2].cumulativePnl, 1300, "Jan 5 cumulative +1300")
  assert(series[2].tradeCount === 1, "Jan 5 trades closed = 1")

  // Input array must not be mutated (identity, order, contents).
  assert(shuffled.length === 4, "input length unchanged")
  assert(shuffled[0].id === "t4" && shuffled[3].id === "t2", "input order unchanged")
  assertClose(shuffled[2].pnl, 100, "input trade pnl unchanged")
}

// ============================================================ EDGE CASES

console.log("--- open trades, breakevens, empty ---")
{
  const open = trade({ id: "open1", endDate: undefined, endTime: undefined, pnl: -9999, accountId: "acc-a" })
  const breakeven = trade({ id: "be1", endDate: "2026-01-02", pnl: 0, accountId: "acc-a" })
  const series = buildCumulativePnlSeries([open, breakeven, t1])
  assert(series.length === 1, "open trade excluded -> only one close day")
  assertClose(series[0].dailyPnl, 500, "breakeven contributes $0 to daily P&L (500 + 0)")
  assert(series[0].tradeCount === 2, "breakeven still counted among closed trades that day")
  assert(open.pnl === -9999, "open trade untouched")

  const empty = buildCumulativePnlSeries([])
  assert(empty.length === 0, "no trades -> empty series")

  const onlyOpen = buildCumulativePnlSeries([open])
  assert(onlyOpen.length === 0, "only open trades -> empty series")

  const closedMissingDate = trade({ id: "bad", endDate: "not-a-date", pnl: 500 })
  const bad = buildCumulativePnlSeries([closedMissingDate])
  assert(bad.length === 0, "closed trade with invalid close date excluded")

  const nonFinitePnl = trade({ id: "nan", endDate: "2026-01-06", pnl: Number.NaN })
  const nanSeries = buildCumulativePnlSeries([nonFinitePnl])
  assert(nanSeries.length === 1 && nanSeries[0].dailyPnl === 0, "non-finite pnl treated as $0 (never NaN in the chart)")
}

// ============================================================ SCOPE

console.log("--- account scope / All Accounts ---")
{
  const all = [t1, t2, t3, t4]
  const scopeA = { kind: "selected", accountIds: ["acc-a"] } as const

  const scopedA = buildCumulativePnlSeries(filterTradesByScope(all, scopeA))
  assert(scopedA.length === 2, "account A has 2 close days (t4 belongs to B)")
  assertClose(scopedA[1].cumulativePnl, 400, "account A cumulative +400")

  const scopedAll = buildCumulativePnlSeries(all)
  assertClose(scopedAll[2].cumulativePnl, 1300, "All Accounts cumulative = chronological SUM (+1300), not an average")

  const scopeB = { kind: "selected", accountIds: ["acc-b"] } as const
  const scopedB = buildCumulativePnlSeries(filterTradesByScope(all, scopeB))
  assertClose(scopedB[0].cumulativePnl, 900, "account B cumulative +900")
}

// ============================================================ EQUITY

console.log("--- buildEquitySeries ---")
{
  const series = buildCumulativePnlSeries([t1, t2, t3, t4])
  const equity = buildEquitySeries(series, [adjustment({ date: "2026-01-04", amount: 500, type: "add" })], 1000)

  assertClose(equity.get("2026-01-02") ?? 0, 1500, "Jan 2 equity = 1000 + 500 realized = 1500 (deposit later)")
  assertClose(equity.get("2026-01-03") ?? 0, 1400, "Jan 3 equity = 1000 + 400 = 1400 (deposit later)")
  assertClose(equity.get("2026-01-05") ?? 0, 2800, "Jan 5 equity = 1000 + 1300 + 500 deposit = 2800")

  const withdrawal = buildEquitySeries(series, [adjustment({ date: "2026-01-01", amount: 200, type: "subtract" })], 1000)
  assertClose(withdrawal.get("2026-01-02") ?? 0, 1300, "same-date withdrawal reduces equity (1000 - 200 + 500)")

  const noFlows = buildEquitySeries(series, [], 1000)
  assertClose(noFlows.get("2026-01-05") ?? 0, 2300, "no flows -> equity = starting balance + realized P&L")
}

// ============================================================ MERGED POINTS

console.log("--- buildPnlChartPoints ---")
{
  const returnByDate = new Map<string, number | null>([
    ["2026-01-02", 5],
    ["2026-01-03", -0.95],
    ["2026-01-05", 8.18],
  ])
  const points = buildPnlChartPoints({
    trades: [t1, t2, t3, t4],
    adjustments: [adjustment({ date: "2026-01-04", amount: 500, type: "add" })],
    startingBalance: 1000,
    returnByDate,
  })
  assert(points.length === 3, "merged points per close day")
  assertClose(points[1].cumulativePnl, 400, "merged keeps cumulative P&L")
  assertClose(points[2].equity ?? 0, 2800, "merged carries equity")
  assertClose(points[0].returnPct ?? 0, 5, "merged carries canonical daily return %")
  assert(points[0].date === "2026-01-02", "merged points are chronological")
}

// ============================================================ CANONICAL ALIGNMENT

console.log("--- P&L series agrees with account daily series (weekday closes) ---")
{
  // Weekday-only closes so the canonical account daily series includes every
  // realized day (the daily-return series intentionally skips weekends).
  const w1 = trade({ id: "w1", date: "2026-01-05", endDate: "2026-01-05", pnl: 500, accountId: "acc-a" })
  const w2 = trade({ id: "w2", date: "2026-01-05", endDate: "2026-01-06", pnl: -200, accountId: "acc-a" })
  const w3 = trade({ id: "w3", date: "2026-01-05", endDate: "2026-01-06", pnl: 100, accountId: "acc-a" })
  const w4 = trade({ id: "w4", date: "2026-01-08", endDate: "2026-01-08", pnl: 900, accountId: "acc-b" })

  const account = { id: "acc-a", name: "A", startingBalance: 1000, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }
  const daily = buildAccountDailySeries(account, [w1, w2, w3], [])
  const byDate = new Map<string, DailyEquityPoint>()
  for (const point of daily.points) byDate.set(point.date, point)

  const series = buildCumulativePnlSeries([w1, w2, w3])
  assertClose(series[0].dailyPnl, byDate.get("2026-01-05")?.realizedPnl ?? 0, "Jan 5 daily P&L matches account series")
  assertClose(series[1].dailyPnl, byDate.get("2026-01-06")?.realizedPnl ?? 0, "Jan 6 daily P&L matches account series")
  assertClose(series[1].cumulativePnl, 400, "chart cumulative for account A = 400")

  // All Accounts aggregate P&L per day equals the capital-weighted aggregate series' total realized P&L.
  const accounts = [
    { id: "acc-a", name: "A", startingBalance: 1000, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "acc-b", name: "B", startingBalance: 5000, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" },
  ]
  const aggDaily = buildAggregateDailySeries(accounts, [w1, w2, w3, w4], [])
  const aggByDate = new Map<string, DailyEquityPoint>()
  for (const point of aggDaily.points) aggByDate.set(point.date, point)

  const allSeries = buildCumulativePnlSeries([w1, w2, w3, w4])
  assertClose(allSeries[1].dailyPnl, aggByDate.get("2026-01-06")?.realizedPnl ?? 0, "Jan 6 aggregate daily P&L matches aggregate series")
  assertClose(allSeries[2].dailyPnl, aggByDate.get("2026-01-08")?.realizedPnl ?? 0, "Jan 8 aggregate daily P&L matches aggregate series")
  assertClose(allSeries[2].cumulativePnl, 1300, "All Accounts cumulative = 1300 (chronological SUM)")
}

console.log(`\npnl-series: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
