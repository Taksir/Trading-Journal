/**
 * Deterministic tests for the Review System:
 * - review status (complete / partial / needs-review / open / inferred-not-manual /
 *   thesis-not-required / review patches never touch financial fields)
 * - setup analytics (counts, win rate, expectancy, profit factor, total P&L,
 *   account filtering, open excluded, unassigned separate, no mutation)
 * - grade analytics (A isolated, B isolated, ungraded separate, expectancy, no mutation)
 * - process / mistake analytics (followed group, violated group, null excluded,
 *   multiple mistakes, counted once per category, no bogus "cost")
 * - stop adherence (5% vs 6% -> +1.0 p.p. worse; 5% vs 3% -> -2.0 p.p. favorable;
 *   inferred excluded; open excluded; breakeven excluded; tolerance centralized)
 * - P&L calendar (close-date grouping, same-day aggregation, account-specific,
 *   capital-weighted aggregate reuse, adjustments separate, weekend consistency)
 *
 * Run with: npm run test:review
 */
import type { BalanceAdjustment, Trade } from "../types/trade.ts"
import type { TradingAccount } from "../types/account.ts"
import type { Setup } from "../types/setup.ts"
import { MISTAKES, MISTAKE_IDS } from "../types/review.ts"
import {
  applyStopInfo,
  getManualStopPct,
  getReviewSignals,
  getReviewStatus,
  getReviewStatusLabel,
  getStopDeviationPct,
  isBreakeven,
  isTradeReviewed,
  needsReview,
} from "../utils/trade-review.ts"
import { isTradeClosed } from "../utils/quant-metrics.ts"
import {
  applyReviewPatch,
  calculateGradePerformance,
  calculateMistakePerformance,
  calculateProcessPerformance,
  calculateSetupPerformance,
  calculateStopAdherence,
  getSampleSizeBand,
  SAMPLE_SIZE,
  STOP_ADHERENCE_TOLERANCE_PP,
  summarizeReview,
  sortClosedTradesByCloseDate,
  normalizeMistakeIds,
} from "../utils/review-analytics.ts"
import {
  buildAccountDailySeries,
  buildAggregateDailySeries,
  filterTradesByScope,
} from "../utils/account-analytics.ts"
import {
  groupClosedTradesByCloseDate,
  summarizeDailySeries,
  sumClosedTradePnl,
  toCalendarDayPoints,
} from "../utils/calendar-analytics.ts"
import type { AccountScope } from "../types/account.ts"

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
    assert(Math.abs(actual - expected) <= eps, `${label} (got ${actual}, expected ${expected})`)
  }
}

let sequence = 0
function trade(overrides: Partial<Trade> = {}): Trade {
  sequence += 1
  return {
    id: overrides.id || `trade-${sequence}`,
    date: "2026-01-05",
    time: "10:00",
    endDate: "2026-01-05",
    endTime: "15:00",
    asset: "TEST",
    tradeType: "Long",
    entryPrice: 100,
    exitPrice: 110,
    stopLoss: 95,
    takeProfit: 0,
    positionSize: 10,
    riskPercent: 1,
    rMultiple: 1,
    pnl: 100,
    fee: 0,
    riskAmount: 50,
    idealRiskAmount: 100,
    actualRiskAmount: 50,
    riskDeviation: 0,
    expectedR: 1,
    isOverRisked: false,
    isUnderRisked: false,
    duration: "1d",
    system: "Breakout",
    timeframe: "1h",
    notes: "",
    tags: [],
    outcome: "Win",
    grade: "A",
    session: "London",
    dayOfWeek: "Monday",
    ...overrides,
  }
}

function account(overrides: Partial<TradingAccount> = {}): TradingAccount {
  return {
    id: overrides.id || `acc-${sequence}`,
    name: overrides.name || `Account ${sequence}`,
    startingBalance: 10000,
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function adjustment(overrides: Partial<BalanceAdjustment> = {}): BalanceAdjustment {
  return {
    id: `adj-${sequence}`,
    amount: 500,
    reason: "Deposit",
    type: "add",
    date: "2026-01-02",
    time: "00:00",
    ...overrides,
  }
}

const SETUPS: Setup[] = [
  { id: "setup-breakout", name: "Breakout", builtIn: true },
  { id: "setup-pullback", name: "Pullback", builtIn: true },
]

function closed(overrides: Partial<Trade> = {}): Trade {
  return trade({ endDate: overrides.endDate || "2026-01-05", ...overrides })
}

// ============================================================ REVIEW STATUS

console.log("--- review status ---")
{
  const complete = closed({
    id: "rs-complete",
    setupId: "setup-breakout",
    manualSetupGrade: "A",
    manualProcessFollowed: true,
    reviewNotes: "clean",
    stopLoss: 95,
  })
  assert(getReviewStatus(complete) === "complete", "complete: all 5 signals -> complete")
  assert(isTradeReviewed(complete), "complete: isTradeReviewed true")
  assert(!needsReview(complete), "complete: does not need review")
  assert(getReviewStatusLabel(complete) === "Reviewed", "complete: label Reviewed")

  const partial = closed({
    id: "rs-partial",
    setupId: "setup-breakout",
    manualSetupGrade: "B",
    stopLoss: 95,
  })
  assert(getReviewStatus(partial) === "partial", "partial: 2 signals -> partial")
  assert(!isTradeReviewed(partial), "partial: not fully reviewed")
  assert(needsReview(partial), "partial: still needs review")
  assert(getReviewStatusLabel(partial) === "Partial", "partial: label Partial")

  const none = closed({ id: "rs-none", stopLoss: 0, pnl: -50 })
  assert(getReviewStatus(none) === "needs-review", "none: 0 signals -> needs-review")
  assert(needsReview(none), "none: needs review")
  assert(getReviewStatusLabel(none) === "Needs Review", "none: label Needs Review")

  const open = trade({ id: "rs-open", endDate: undefined, pnl: 0, stopLoss: 0 })
  assert(!needsReview(open), "open: never needs review")
  assert(!isTradeReviewed(open), "open: not reviewed")
  assert(getReviewStatusLabel(open) === "Open", "open: label Open")

  // Inferred stop satisfies "stop info" but is NOT a consciously planned stop.
  const inferred = applyStopInfo(closed({ id: "rs-inferred", stopLoss: 0, pnl: -70 }))
  assert(inferred.stopSource === "inferred", "inferred: stopSource = inferred")
  const inferredSignals = getReviewSignals(inferred)
  assert(inferredSignals.hasStopInfo === true, "inferred: counts as stop info")
  assert(inferredSignals.hasPlannedStopRecorded === false, "inferred: NOT a planned stop record")

  // Manual stop records a planned stop.
  const manualSignals = getReviewSignals(complete)
  assert(manualSignals.hasPlannedStopRecorded === true, "manual: records a planned stop")

  // Thesis is NOT required for completeness.
  const noThesis = closed({
    id: "rs-no-thesis",
    setupId: "setup-breakout",
    manualSetupGrade: "A",
    manualProcessFollowed: false,
    reviewNotes: "reviewed without thesis",
    stopLoss: 95,
  })
  assert(noThesis.tradeThesis === undefined, "thesis: absent on fixture")
  assert(getReviewStatus(noThesis) === "complete", "thesis: not required for completeness")

  // Review patches never touch financial fields.
  const patchTarget = closed({
    id: "rs-patch",
    setupId: undefined,
    entryPrice: 55,
    exitPrice: 66,
    pnl: 123.45,
    fee: 2.5,
    positionSize: 7,
    date: "2026-02-01",
    endDate: "2026-02-02",
  })
  const patched = applyReviewPatch(patchTarget, {
    setupId: "setup-pullback",
    manualSetupGrade: "A+",
    manualProcessFollowed: false,
    manualMistakeIds: [MISTAKE_IDS.brokeStop],
    tradeThesis: "thesis",
    reviewNotes: "notes",
  })
  assert(patched.setupId === "setup-pullback", "patch: setup applied")
  assert(patched.manualSetupGrade === "A+", "patch: grade applied")
  assert(patched.manualProcessFollowed === false, "patch: process applied")
  assert(patched.manualMistakeIds?.includes(MISTAKE_IDS.brokeStop), "patch: mistakes applied")
  assert(patched.entryPrice === 55, "patch: entry untouched")
  assert(patched.exitPrice === 66, "patch: exit untouched")
  assertClose(patched.pnl, 123.45, "patch: pnl untouched")
  assertClose(patched.fee, 2.5, "patch: fee untouched")
  assert(patched.positionSize === 7, "patch: positionSize untouched")
  assert(patched.date === "2026-02-01", "patch: dates untouched")
  assert(patched.endDate === "2026-02-02", "patch: endDate untouched")

  // A partial patch leaves the other review fields intact.
  const partialPatch = applyReviewPatch(patchTarget, { setupId: "setup-pullback" })
  assert(partialPatch.setupId === "setup-pullback", "partial patch: setup applied")
  assert(partialPatch.manualProcessFollowed === undefined, "partial patch: process untouched")
  assert(partialPatch.manualMistakeIds === undefined, "partial patch: mistakes untouched")
  assert(partialPatch.reviewNotes === undefined, "partial patch: notes untouched")

  // Clearing: the review dialog sends `undefined` for a field the user cleared,
  // and applyReviewPatch must actually REMOVE it rather than skip it.
  const withReview = applyReviewPatch(patchTarget, {
    setupId: "setup-breakout",
    manualProcessFollowed: true,
    manualMistakeIds: [MISTAKE_IDS.chasedEntry],
    reviewNotes: "some notes",
  })
  assert(withReview.setupId === "setup-breakout", "clear: value present before")
  assert(withReview.reviewNotes === "some notes", "clear: notes present before")
  const cleared = applyReviewPatch(withReview, {
    setupId: undefined,
    manualProcessFollowed: undefined,
    manualMistakeIds: undefined,
    reviewNotes: undefined,
  })
  assert(cleared.setupId === undefined, "clear: setupId removed")
  assert(cleared.manualProcessFollowed === undefined, "clear: process removed")
  assert(cleared.manualMistakeIds === undefined, "clear: mistakes removed")
  assert(cleared.reviewNotes === undefined, "clear: notes removed")
  assert(cleared.entryPrice === 55, "clear: entry untouched")
  assertClose(cleared.pnl, 123.45, "clear: pnl untouched")
}

// ============================================================ SETUP ANALYTICS

console.log("--- setup analytics ---")
{
  // Breakout: 2 wins + 1 loss; Pullback: 1 loss; Unassigned: 1 win.
  const trades: Trade[] = [
    closed({ id: "s1", setupId: "setup-breakout", pnl: 100, rMultiple: 1, idealRiskAmount: 100 }),
    closed({ id: "s2", setupId: "setup-breakout", pnl: 150, rMultiple: 1.5, idealRiskAmount: 100 }),
    closed({ id: "s3", setupId: "setup-breakout", pnl: -50, rMultiple: -0.5, idealRiskAmount: 100 }),
    closed({ id: "s4", setupId: "setup-pullback", pnl: -30, rMultiple: -0.3, idealRiskAmount: 100 }),
    closed({ id: "s5", pnl: 40, rMultiple: 0.4, idealRiskAmount: 100 }),
    // Open trade: excluded entirely.
    trade({ id: "s6", setupId: "setup-breakout", endDate: undefined, pnl: -999 }),
  ]

  const rows = calculateSetupPerformance(trades, SETUPS)
  const breakout = rows.find((r) => r.setupId === "setup-breakout")
  const pullback = rows.find((r) => r.setupId === "setup-pullback")
  const unassigned = rows.find((r) => r.setupId === null)

  assert(breakout?.tradeCount === 3, "setup: breakout count 3 (open excluded)")
  assertClose(breakout?.winRate ?? null, 66.67, "setup: breakout win rate 2/3")
  assertClose(breakout?.expectancyR ?? null, 0.67, "setup: breakout expectancy 2/3 R")
  assertClose(breakout?.profitFactor ?? null, 250 / 50, "setup: breakout PF 5.0")
  assertClose(breakout?.totalNetPnl ?? null, 200, "setup: breakout net P&L 200")
  assertClose(pullback?.expectancyR ?? null, -0.3, "setup: pullback expectancy -0.3")
  assert(unassigned?.tradeCount === 1, "setup: unassigned separate group")
  assertClose(unassigned?.totalNetPnl ?? null, 40, "setup: unassigned net P&L 40")

  // Default sort: expectancy descending (pullback -0.3 < unassigned 0.4 < breakout 0.67).
  assert(rows[0]?.setupId === "setup-breakout", "setup: sorted by expectancy desc")
  assert(rows[rows.length - 1]?.setupId === "setup-pullback", "setup: lowest expectancy last")

  // Account filtering: scope first, then analyze.
  const accA = account({ id: "acc-a" })
  const accB = account({ id: "acc-b" })
  const scopedA = filterTradesByScope(
    trades.map((t) => ({ ...t, accountId: "acc-a" })),
    { kind: "selected", accountIds: ["acc-a"] },
  )
  assert(scopedA.length === trades.length, "setup: scope filter passes all (all acc-a)")

  const before = JSON.stringify(trades)
  calculateSetupPerformance(trades, SETUPS)
  assert(JSON.stringify(trades) === before, "setup: no mutation")
}

// ============================================================ GRADE ANALYTICS

console.log("--- grade analytics ---")
{
  const trades: Trade[] = [
    closed({ id: "g1", manualSetupGrade: "A+", pnl: 120, idealRiskAmount: 100 }),
    closed({ id: "g2", manualSetupGrade: "A+", pnl: -40, idealRiskAmount: 100 }),
    closed({ id: "g3", manualSetupGrade: "B", pnl: 60, idealRiskAmount: 100 }),
    closed({ id: "g4", pnl: 30, idealRiskAmount: 100 }),
    closed({ id: "g5", pnl: -20, idealRiskAmount: 100 }),
  ]

  const result = calculateGradePerformance(trades)
  const aPlus = result.buckets.find((b) => b.grade === "A+")
  const b = result.buckets.find((b) => b.grade === "B")

  assert(aPlus?.tradeCount === 2, "grade: A+ isolated count 2")
  assertClose(aPlus?.winRate ?? null, 50, "grade: A+ win rate 50%")
  assertClose(aPlus?.expectancyR ?? null, 0.4, "grade: A+ expectancy (1.2 + -0.4)/2 = 0.4")
  assert(b?.tradeCount === 1, "grade: B isolated count 1")
  assertClose(b?.expectancyR ?? null, 0.6, "grade: B expectancy 0.6")
  assert(result.ungraded?.tradeCount === 2, "grade: ungraded separate")
  assertClose(result.ungraded?.totalNetPnl ?? null, 10, "grade: ungraded net P&L 10")

  const before = JSON.stringify(trades)
  calculateGradePerformance(trades)
  assert(JSON.stringify(trades) === before, "grade: no mutation")
}

// ============================================================ PROCESS / MISTAKES

console.log("--- process / mistakes ---")
{
  const followedTrades = [
    closed({ id: "p1", manualProcessFollowed: true, pnl: 100, idealRiskAmount: 100 }),
    closed({ id: "p2", manualProcessFollowed: true, pnl: -50, idealRiskAmount: 100 }),
  ]
  const violatedTrades = [
    closed({ id: "p3", manualProcessFollowed: false, pnl: -30, idealRiskAmount: 100 }),
    closed({ id: "p4", manualProcessFollowed: false, pnl: -20, idealRiskAmount: 100 }),
  ]
  const unreviewed = [closed({ id: "p5", pnl: 200, idealRiskAmount: 100 }), trade({ id: "p6", endDate: undefined, pnl: -999 })]

  const process = calculateProcessPerformance([...followedTrades, ...violatedTrades, ...unreviewed])
  assert(process.followed.tradeCount === 2, "process: followed count 2")
  assertClose(process.followed.expectancyR ?? null, 0.25, "process: followed expectancy 0.25")
  assert(process.violated.tradeCount === 2, "process: violated count 2")
  assertClose(process.violated.expectancyR ?? null, -0.25, "process: violated expectancy -0.25")
  assert(process.reviewedCount === 4, "process: reviewed count 4")
  assert(process.unreviewedCount === 1, "process: null excluded (open also excluded)")

  // Mistakes: multiple per trade; counted once per category.
  const mistakeTrades = [
    closed({
      id: "m1",
      manualMistakeIds: [MISTAKE_IDS.brokeStop, MISTAKE_IDS.chasedEntry],
      pnl: -60,
      idealRiskAmount: 100,
    }),
    closed({ id: "m2", manualMistakeIds: [MISTAKE_IDS.brokeStop, MISTAKE_IDS.brokeStop], pnl: -30, idealRiskAmount: 100 }),
    closed({ id: "m3", manualMistakeIds: [MISTAKE_IDS.revengeEmotional], pnl: 50, idealRiskAmount: 100 }),
  ]
  const mistakes = calculateMistakePerformance(mistakeTrades)
  const brokeStop = mistakes.find((m) => m.mistakeId === MISTAKE_IDS.brokeStop)
  const chased = mistakes.find((m) => m.mistakeId === MISTAKE_IDS.chasedEntry)
  const revenge = mistakes.find((m) => m.mistakeId === MISTAKE_IDS.revengeEmotional)

  assert(brokeStop?.affectedTradeCount === 2, "mistake: duplicate id counted once per category")
  assertClose(brokeStop?.netPnl ?? null, -90, "mistake: net P&L -90 (sum, not abs/cost)")
  assertClose(brokeStop?.avgR ?? null, -0.45, "mistake: avg R -0.45")
  assert(chased?.affectedTradeCount === 1, "mistake: second category counts its own trade")
  assert(revenge?.affectedTradeCount === 1, "mistake: revenge category separate")
  assertClose(revenge?.netPnl ?? null, 50, "mistake: net P&L can be positive")
  assert(brokeStop && brokeStop.netPnl < 0, "mistake: net P&L is signed, not an absolute cost")

  // Unlisted mistakes omitted.
  const empty = calculateMistakePerformance([closed({ id: "m9", manualMistakeIds: [] })])
  assert(empty.length === 0, "mistake: no categories when none tagged")
}

// ============================================================ STOP ADHERENCE

console.log("--- stop adherence ---")
{
  assert(STOP_ADHERENCE_TOLERANCE_PP === 0.05, "stop: tolerance centralized at 0.05 p.p.")

  // Manual stop 5% (entry 100, stop 95). Realized loss 6% -> +1.0 p.p. (exceeding).
  const worse = closed({ id: "w1", entryPrice: 100, stopLoss: 95, positionSize: 10, pnl: -60 })
  assertClose(getManualStopPct(worse) ?? null, 5, "stop: manual stop 5%")
  assertClose(getStopDeviationPct(worse) ?? null, 1, "stop: 6% vs 5% = +1.0 p.p.")

  // Manual stop 5%. Realized loss 3% -> -2.0 p.p. (favorable).
  const better = closed({ id: "w2", entryPrice: 100, stopLoss: 95, positionSize: 10, pnl: -30 })
  assertClose(getStopDeviationPct(better) ?? null, -2, "stop: 3% vs 5% = -2.0 p.p.")

  // Inferred stop (no manual stop) excluded.
  const inferred = applyStopInfo(closed({ id: "w3", entryPrice: 100, stopLoss: 0, positionSize: 10, pnl: -70 }))
  assert(getStopDeviationPct(inferred) === null, "stop: inferred stop excluded from adherence")

  // Open losing trade excluded.
  const open = trade({ id: "w4", endDate: undefined, entryPrice: 100, stopLoss: 95, positionSize: 10, pnl: -500 })
  assert(!isTradeClosed(open), "stop: open trade fixture")
  assert(getStopDeviationPct(open) === null, "stop: open trade excluded")

  // Breakeven excluded (never a losing stop).
  const breakeven = closed({ id: "w5", entryPrice: 100, stopLoss: 95, positionSize: 10, pnl: 0 })
  assert(isBreakeven(breakeven), "stop: breakeven fixture")
  assert(getStopDeviationPct(breakeven) === null, "stop: breakeven excluded")

  const metrics = calculateStopAdherence([
    worse,
    better,
    inferred,
    open,
    breakeven,
    closed({ id: "w6", entryPrice: 100, stopLoss: 95, positionSize: 10, pnl: -50.3 }),
  ])
  assert(metrics.totalLosing === 4, "stop: total losing 4 (worse, better, inferred, w6)")
  assert(metrics.losingWithManualStop === 3, "stop: sample = 3 manual-stopped losers")
  assertClose(metrics.coveragePct ?? null, 75, "stop: coverage 3/4 = 75%")
  assertClose(metrics.avgDeviationPct ?? null, (1 + -2 + 0.03) / 3, "stop: avg deviation p.p.")
  assert(metrics.exceedingCount === 1, "stop: exceeding (worse +1.0)")
  assert(metrics.favorableCount === 1, "stop: favorable (better -2.0)")
  assert(metrics.containedCount === 1, "stop: contained (w6 +0.03 <= 0.05)")

  // Coverage denominator excludes breakevens and open trades.
  const mixed = calculateStopAdherence([
    worse,
    breakeven,
    open,
    closed({ id: "w7", entryPrice: 100, stopLoss: 0, positionSize: 10, pnl: -10 }),
  ])
  assert(mixed.totalLosing === 2, "stop: total losing counts losers only (worse + inferred)")
  assert(mixed.losingWithManualStop === 1, "stop: only manual-stopped loser in sample")
  assertClose(mixed.coveragePct ?? null, 50, "stop: coverage 1/2 = 50%")
}

// ============================================================ P&L CALENDAR

console.log("--- daily p&l calendar ---")
{
  const accA = account({ id: "acc-a", name: "A", startingBalance: 10000 })
  const accB = account({ id: "acc-b", name: "B", startingBalance: 40000 })

  const a1 = closed({ id: "c1", accountId: "acc-a", date: "2026-01-05", endDate: "2026-01-05", pnl: 200, idealRiskAmount: 100 })
  const a2 = closed({ id: "c2", accountId: "acc-a", date: "2026-01-05", endDate: "2026-01-05", pnl: -100, idealRiskAmount: 100 })
  const a3 = closed({ id: "c3", accountId: "acc-a", date: "2026-01-06", endDate: "2026-01-06", pnl: 50, idealRiskAmount: 100 })
  const b1 = closed({ id: "c4", accountId: "acc-b", date: "2026-01-05", endDate: "2026-01-05", pnl: 2000, idealRiskAmount: 100 })
  const all = [a1, a2, a3, b1]

  // Close-date grouping.
  const grouped = groupClosedTradesByCloseDate(all)
  assert(grouped.get("2026-01-05")?.length === 3, "calendar: 3 trades close on 2026-01-05")
  assert(grouped.get("2026-01-06")?.length === 1, "calendar: 1 trade closes on 2026-01-06")
  assertClose(sumClosedTradePnl(grouped.get("2026-01-05") || []), 2100, "calendar: same-day net P&L 200-100+2000")

  // Account-specific series.
  const seriesA = buildAccountDailySeries(accA, all, [])
  const pointsA = summarizeDailySeries(toCalendarDayPoints(seriesA.points))
  assertClose(pointsA.byDay.get("2026-01-05")?.netPnl ?? null, 100, "calendar: account A day1 = 100")
  assertClose(pointsA.byDay.get("2026-01-06")?.netPnl ?? null, 50, "calendar: account A day2 = 50")
  assertClose(pointsA.byDay.get("2026-01-05")?.returnPct ?? null, 1, "calendar: A return 1% (100/10000)")

  // All Accounts = capital-weighted aggregate (reuses existing utility).
  const aggregate = buildAggregateDailySeries([accA, accB], all, [])
  const pointsAll = summarizeDailySeries(toCalendarDayPoints(aggregate.points))
  assertClose(pointsAll.byDay.get("2026-01-05")?.netPnl ?? null, 2100, "calendar: aggregate day1 net 2100")
  assertClose(pointsAll.byDay.get("2026-01-05")?.returnPct ?? null, 4.2, "calendar: aggregate 2100/50000 = 4.2%")

  // Weekends excluded from the series (2026-01-04 is a Sunday).
  assert(aggregate.points.every((p) => !["2026-01-04"].includes(p.date)), "calendar: weekends excluded")

  // Adjustments ride along but never inflate trading return.
  const withFlow = buildAccountDailySeries(
    accA,
    [a1],
    [adjustment({ accountId: "acc-a", amount: 5000, type: "add", date: "2026-01-05" })],
  )
  const flowPoints = summarizeDailySeries(toCalendarDayPoints(withFlow.points))
  assertClose(flowPoints.byDay.get("2026-01-05")?.netPnl ?? null, 200, "calendar: trading P&L ignores deposit")
  assertClose(flowPoints.byDay.get("2026-01-05")?.adjustments ?? null, 5000, "calendar: adjustments reported separately")
  assertClose(flowPoints.byDay.get("2026-01-05")?.returnPct ?? null, 2, "calendar: same-day deposit does not inflate return (200/10000)")

  // Month summary.
  const months = summarizeDailySeries(toCalendarDayPoints(aggregate.points))
  const jan = months.months.find((m) => m.monthKey === "2026-01")
  assert(jan?.tradingDays === 2, "calendar: January has 2 trading days")
  assertClose(jan?.netPnl ?? null, 2150, "calendar: January net P&L 2100 + 50")
  assert(jan?.profitableDays === 2, "calendar: January 2 profitable days")
  assert(jan?.losingDays === 0, "calendar: January 0 losing days")
  assert(jan?.bestDay?.date === "2026-01-05", "calendar: best day 01-05")
  assert(jan?.worstDay?.date === "2026-01-06", "calendar: worst day 01-06")

  // Scope filtering drives calendar input.
  const scopeA: AccountScope = { kind: "selected", accountIds: ["acc-a"] }
  const scoped = filterTradesByScope(all, scopeA)
  assertClose(sumClosedTradePnl(scoped), 150, "calendar: account-scoped P&L 200 - 100 + 50 = 150")
}

// ============================================================ SHARED HELPERS

console.log("--- review summary / helpers ---")
{
  const trades = [
    closed({ id: "h1", setupId: "setup-breakout", manualSetupGrade: "A", manualProcessFollowed: true, reviewNotes: "x", stopLoss: 95 }),
    closed({ id: "h2", setupId: "setup-breakout", manualSetupGrade: "B", stopLoss: 95 }),
    closed({ id: "h3", pnl: -10, stopLoss: 0 }),
    trade({ id: "h4", endDate: undefined, pnl: 0 }),
  ]
  const summary = summarizeReview(trades)
  assert(summary.totalClosed === 3, "summary: totalClosed 3 (open excluded)")
  assert(summary.complete === 1, "summary: complete 1")
  assert(summary.partial === 1, "summary: partial 1 (h2)")
  assert(summary.needsReview === 1, "summary: needs-review 1 (h3)")
  assert(summary.missingProcess === 2, "summary: missing process 2")
  assert(summary.missingNotes === 2, "summary: missing notes 2")
  assert(summary.missingSetup === 1, "summary: missing setup 1")

  const sorted = sortClosedTradesByCloseDate([
    closed({ id: "h5", date: "2026-01-01", endDate: "2026-01-01" }),
    closed({ id: "h6", date: "2026-01-03", endDate: "2026-01-03" }),
    closed({ id: "h7", date: "2026-01-02", endDate: "2026-01-02" }),
  ])
  assert(sorted[0].id === "h6" && sorted[2].id === "h5", "helpers: closed trades sorted newest first")

  assert(JSON.stringify(normalizeMistakeIds(["a", "a", "b", ""])) === JSON.stringify(["a", "b"]), "helpers: mistake ids deduped")

  assert(getSampleSizeBand(4) === "very-small", "sample size: n<5 very small")
  assert(getSampleSizeBand(5) === "limited", "sample size: n=5 limited")
  assert(getSampleSizeBand(19) === "limited", "sample size: n=19 limited")
  assert(getSampleSizeBand(20) === null, "sample size: n>=20 no warning")
  assert(SAMPLE_SIZE.verySmall === 5 && SAMPLE_SIZE.limited === 20, "sample size: thresholds centralized")

  assert(MISTAKES.length === 13, "mistake catalog: 13 categories with stable ids")
  assert(MISTAKES.every((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i), "mistake catalog: ids unique")
}

console.log("")
if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`)
  process.exit(1)
} else {
  console.log(`${passed} passed, 0 failed`)
}
