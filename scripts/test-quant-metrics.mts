import {
  calculateDrawdown,
  calculateLossStreaks,
  calculateNetR,
  calculateQuantMetrics,
  calculateTradeReturnPct,
  calculateDailyReturns,
  mean,
  sampleStdDev,
} from "../utils/quant-metrics.ts"
import type { Settings, Trade } from "../types/trade.ts"

const SETTINGS: Settings = {
  accountBalance: 1000,
  assetFees: {},
  tradingSystems: [],
  tradingSessions: [],
  riskDeviationTolerance: 10,
  systemIdealRisk: {},
  defaultIdealRisk: 100,
}

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

function assertClose(actual: number | null, expected: number | null, label: string, eps = 0.01): void {
  if (actual === null || expected === null) {
    assert(actual === expected, `${label} (got ${actual}, expected ${expected})`)
  } else {
    assert(Math.abs(actual - expected) < eps, `${label} (got ${actual.toFixed(4)}, expected ${expected})`)
  }
}

// ---------------------------------------------------------------------------
// Deterministic example: 6 closed trades, starting balance 1000.
// close dates: 01-06(W), 01-07(W), 01-08(L), 01-09(L), 01-12(BE), 01-13(W)
// 2026 weekdays: 05=Mon ... 06=Tue, 07=Wed, 08=Thu, 09=Fri, 12=Mon, 13=Tue
// ---------------------------------------------------------------------------

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: "x",
    date: "2026-01-05",
    time: "09:00",
    endDate: "2026-01-06",
    endTime: "15:00",
    asset: "TEST",
    tradeType: "Long",
    entryPrice: 0,
    exitPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    positionSize: 0,
    riskPercent: 1,
    rMultiple: 0,
    pnl: 0,
    fee: 0,
    riskAmount: 0,
    idealRiskAmount: 0,
    actualRiskAmount: 0,
    riskDeviation: 0,
    expectedR: 999, // deliberately stale: metrics must recompute from pnl + risk
    isOverRisked: false,
    isUnderRisked: false,
    duration: "",
    system: "",
    timeframe: "",
    notes: "",
    tags: [],
    outcome: "Breakeven",
    grade: "",
    session: "",
    dayOfWeek: "",
    ...overrides,
  }
}

const wins = [
  trade({ entryPrice: 100, positionSize: 10, pnl: 80, idealRiskAmount: 100, endDate: "2026-01-06" }),
  trade({ entryPrice: 50, positionSize: 20, pnl: 120, idealRiskAmount: 150, endDate: "2026-01-07" }),
  trade({ entryPrice: 25, positionSize: 20, pnl: 50, idealRiskAmount: 100, endDate: "2026-01-13" }),
]
const losses = [
  trade({ entryPrice: 200, positionSize: 5, pnl: -60, idealRiskAmount: 100, endDate: "2026-01-08" }),
  trade({ entryPrice: 500, positionSize: 2, pnl: -100, idealRiskAmount: 200, endDate: "2026-01-09" }),
]
const breakeven = [trade({ entryPrice: 100, positionSize: 10, pnl: 0, idealRiskAmount: 100, endDate: "2026-01-12" })]

const allTrades = [...wins, ...losses, ...breakeven]

console.log("--- helpers ---")
assertClose(calculateTradeReturnPct(wins[0]), 8, "win1 returnPct (80/1000)")
assertClose(calculateTradeReturnPct(wins[1]), 12, "win2 returnPct (120/1000)")
assertClose(calculateTradeReturnPct(losses[0]), -6, "loss1 returnPct (-60/1000)")
assertClose(calculateTradeReturnPct(trade({ entryPrice: 0, positionSize: 10, pnl: 5 })), null, "zero entry => null")
assertClose(calculateTradeReturnPct(trade({ entryPrice: 100, positionSize: 0, pnl: 5 })), null, "zero size => null")
assertClose(calculateNetR(wins[0]), 0.8, "netR ideal (80/100)")
assertClose(
  calculateNetR(trade({ pnl: 40, idealRiskAmount: 0, actualRiskAmount: 200, rMultiple: 7 })),
  0.2,
  "netR falls back to actual risk (40/200), ignores stale rMultiple/expectedR",
)
assertClose(calculateNetR(trade({ pnl: 40, idealRiskAmount: 0, actualRiskAmount: 0, rMultiple: 7 })), 7, "netR rMultiple fallback")
assertClose(mean([]), null, "mean of empty => null")
assertClose(mean([1, 2, 3]), 2, "mean")
assertClose(sampleStdDev([1, 1]), 0, "sampleStdDev identical values => 0")
assertClose(sampleStdDev([1]), null, "sampleStdDev single value => null")

console.log("--- quant metrics (expected values) ---")
const m = calculateQuantMetrics(allTrades, SETTINGS)

assert(m.totalTrades === 6, `totalTrades 6 (got ${m.totalTrades})`)
assert(m.winningTrades === 3, `winningTrades 3 (got ${m.winningTrades})`)
assert(m.losingTrades === 2, `losingTrades 2 (got ${m.losingTrades})`)
assert(m.breakevenTrades === 1, `breakevenTrades 1 (got ${m.breakevenTrades})`)
assertClose(m.winRate, 50, "winRate 50.0%")

assertClose(m.avgWinPct, 10, "avgWinPct +10.0%")
assertClose(m.avgLossPct, -8, "avgLossPct -8.0%")

assertClose(m.avgWinningR, 0.7, "avgWinningR +0.70R")
assertClose(m.avgLosingR, -0.55, "avgLosingR -0.55R")
assertClose(m.payoffRatio, 0.7 / 0.55, "payoffRatio 1.27x")

assertClose(m.expectancyR, 1 / 6, "expectancyR +0.1667R/trade")

assertClose(m.profitFactor, 250 / 160, "profitFactor 1.5625")

assert(m.maxConsecutiveLosses === 2, `maxConsecutiveLosses 2 (got ${m.maxConsecutiveLosses})`)
assert(m.currentConsecutiveLosses === 0, `currentConsecutiveLosses 0 (got ${m.currentConsecutiveLosses})`)

assertClose(m.maxDrawdownPct, -13.3333, "maxDrawdownPct -13.33%")
assertClose(m.maxDrawdownAmount, -160, "maxDrawdownAmount -$160")
assert(m.dailyObservationCount === 6, `dailyObservationCount 6 (got ${m.dailyObservationCount})`)

console.log("--- daily returns / sharpe / sortino (expected values) ---")
const series = calculateDailyReturns(allTrades, 1000)
assert(series.days.length === 6, `days length 6 (got ${series.days.length})`)
assert(series.days.includes("2026-01-07"), "zero-return weekday (Jan 7) present")
assert(!series.days.some((d) => d.endsWith("-01-10") || d.endsWith("-01-11")), "weekends excluded")

// Expected returns: [0.08, 0.111111, -0.05, -0.0877193, 0, 0.0480769]
assertClose(series.returns[0], 0.08, "return Jan 6")
assertClose(series.returns[1], 120 / 1080, "return Jan 7")
assertClose(series.returns[2], -0.05, "return Jan 8")
assertClose(series.returns[3], -100 / 1140, "return Jan 9")
assertClose(series.returns[4], 0, "return Jan 12 (zero)")
assertClose(series.returns[5], 50 / 1040, "return Jan 13")

assertClose(m.sharpeRatio, 3.493, "sharpeRatio ~3.49")
assertClose(m.sortinoRatio, 6.513, "sortinoRatio ~6.51")

console.log("--- edge cases ---")
const empty = calculateQuantMetrics([], SETTINGS)
assert(empty.totalTrades === 0, "empty: totalTrades 0")
assert(empty.winRate === null, "empty: winRate null")
assert(empty.avgWinPct === null, "empty: avgWinPct null")
assert(empty.avgLossPct === null, "empty: avgLossPct null")
assert(empty.payoffRatio === null, "empty: payoffRatio null")
assert(empty.expectancyR === null, "empty: expectancyR null")
assert(empty.profitFactor === null, "empty: profitFactor null")
assert(empty.sharpeRatio === null, "empty: sharpeRatio null")
assert(empty.sortinoRatio === null, "empty: sortinoRatio null")
assert(empty.maxDrawdownPct === null, "empty: maxDrawdownPct null")
assert(empty.maxDrawdownAmount === 0, "empty: maxDrawdownAmount 0")
assert(empty.maxConsecutiveLosses === 0, "empty: maxLossStreak 0")
assert(empty.dailyObservationCount === 0, "empty: dailyObservationCount 0")

const singleWin = calculateQuantMetrics([wins[0]], SETTINGS)
assert(singleWin.winRate === 100, "single win: winRate 100")
assertClose(singleWin.avgWinPct, 8, "single win: avgWinPct")
assert(singleWin.payoffRatio === Number.POSITIVE_INFINITY, "single win: payoffRatio Infinity")
assert(singleWin.profitFactor === Number.POSITIVE_INFINITY, "single win: profitFactor Infinity")
assert(singleWin.sharpeRatio === null, "single win: sharpe null (<2 observations)")
assert(singleWin.sortinoRatio === null, "single win: sortino null (no downside)")
assert(singleWin.maxDrawdownPct === null, "single win: maxDrawdownPct null (no drawdown)")

const allWinners = calculateQuantMetrics([...wins], SETTINGS)
assert(allWinners.payoffRatio === Number.POSITIVE_INFINITY, "all winners: payoffRatio Infinity")
assert(allWinners.profitFactor === Number.POSITIVE_INFINITY, "all winners: profitFactor Infinity")
assert(allWinners.sortinoRatio === null, "all winners: sortino null (no negative days)")
assert(allWinners.maxConsecutiveLosses === 0, "all winners: maxLossStreak 0")

const allLosers = calculateQuantMetrics(losses, SETTINGS)
assert(allLosers.winRate === 0, "all losers: winRate 0")
assert(allLosers.avgWinPct === null, "all losers: avgWinPct null")
assertClose(allLosers.avgLossPct, -8, "all losers: avgLossPct")
assertClose(allLosers.profitFactor, 0, "all losers: profitFactor 0 (gross profit 0 / gross loss)")
assert(allLosers.payoffRatio === null, "all losers: payoffRatio null (no wins)")

const onlyBreakeven = calculateQuantMetrics([breakeven[0], breakeven[0]], SETTINGS)
assert(onlyBreakeven.winRate === 0, "only breakevens: winRate 0")
assert(onlyBreakeven.avgWinPct === null, "only breakevens: avgWinPct null")
assert(onlyBreakeven.profitFactor === null, "only breakevens: profitFactor null")
assert(onlyBreakeven.expectancyR !== null && Math.abs(onlyBreakeven.expectancyR) < 1e-9, "only breakevens: expectancy 0")
assert(onlyBreakeven.sharpeRatio === null, "only breakevens: sharpe null (<2 observations)")
assert(onlyBreakeven.sortinoRatio === null, "only breakevens: sortino null (no downside)")

const unsorted = calculateQuantMetrics([...allTrades].reverse(), SETTINGS)
assertClose(unsorted.maxDrawdownPct, m.maxDrawdownPct, "out-of-order input: same maxDrawdown")
assert(unsorted.maxConsecutiveLosses === m.maxConsecutiveLosses, "out-of-order input: same streaks")
assertClose(unsorted.sharpeRatio, m.sharpeRatio, "out-of-order input: same sharpe")

const sameDay = calculateQuantMetrics(
  [trade({ pnl: 100, entryPrice: 1000, positionSize: 1, idealRiskAmount: 100, endDate: "2026-01-06" }),
   trade({ pnl: -50, entryPrice: 1000, positionSize: 1, idealRiskAmount: 100, endDate: "2026-01-06" })],
  SETTINGS,
)
assert(sameDay.dailyObservationCount === 1, "same-day closes: single observation")
assert(sameDay.sharpeRatio === null, "same-day closes: sharpe null (<2 observations)")

const zeroBalance = calculateQuantMetrics(allTrades, { ...SETTINGS, accountBalance: 0 })
assert(zeroBalance.sharpeRatio === null, "zero balance: sharpe null")
assert(zeroBalance.sortinoRatio === null, "zero balance: sortino null")
assert(zeroBalance.maxDrawdownPct === null, "zero balance: maxDrawdownPct null (peak not positive)")
assertClose(zeroBalance.maxDrawdownAmount, -160, "zero balance: drawdown amount still computed")

const negativeBalance = calculateQuantMetrics(allTrades, { ...SETTINGS, accountBalance: -500 })
assert(negativeBalance.sharpeRatio === null, "negative balance: sharpe null")
assert(negativeBalance.dailyObservationCount === 0, "negative balance: no daily observations")

const malformed = calculateQuantMetrics(
  [trade({ pnl: Number.NaN, entryPrice: 10, positionSize: 1, endDate: "2026-01-06" }),
   trade({ date: "not-a-date", time: "", pnl: 10, entryPrice: 10, positionSize: 1 })],
  SETTINGS,
)
assert(malformed.totalTrades === 2, "malformed: still counted")
assert(malformed.breakevenTrades === 1, "malformed: NaN pnl treated as breakeven")
assert(malformed.sharpeRatio === null, "malformed: no usable daily series => sharpe null")
assert(malformed.maxConsecutiveLosses === 0, "malformed: no date => no streak")

// ---------------------------------------------------------------------------
// Drawdown + streaks (direct helper checks)
// ---------------------------------------------------------------------------
const dd = calculateDrawdown(allTrades, 1000)
assertClose(dd.maxDrawdownPct, -13.3333, "drawdown helper pct")
assertClose(dd.maxDrawdownAmount, -160, "drawdown helper amount")

const streaks = calculateLossStreaks([...allTrades].reverse())
assert(streaks.maxConsecutiveLosses === 2, "streaks helper max")
assert(streaks.currentConsecutiveLosses === 0, "streaks helper current")

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
