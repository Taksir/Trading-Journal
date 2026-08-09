/**
 * Deterministic tests for the multi-account foundation:
 * - legacy migration (idempotent, values preserved)
 * - per-account vs aggregate analytics (capital-weighted aggregate)
 * - account filtering (scope propagation, no mutation, open-trade exclusion)
 * - import duplicate detection (account-aware)
 * - setup / manual grade / notes / stop inference
 *
 * Run with: npm run test:accounts
 */
import type { BalanceAdjustment, Settings, Trade } from "../types/trade.ts"
import type { TradingAccount, AccountScope } from "../types/account.ts"
import {
  DEFAULT_ACCOUNT_ID,
  ensureAccountsMigration,
} from "../utils/account-migration.ts"
import {
  filterTradesByScope,
  buildAccountDailySeries,
  buildAggregateDailySeries,
  calculateScopeQuantMetrics,
  calculateScopeAdjustedBalance,
  getAccountBalance,
  getAccountNetTradingPnL,
} from "../utils/account-analytics.ts"
import { detectDuplicates, buildTradeSignature } from "../utils/import-dedupe.ts"
import {
  applyStopInfo,
  needsReview,
  getManualStopPct,
  getRealizedLossPct,
  getEffectiveStopPct,
  isClosedLoss,
  isBreakeven,
  getReviewStatusLabel,
} from "../utils/trade-review.ts"
import { isTradeClosed, calculateDrawdown } from "../utils/quant-metrics.ts"

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

const settings: Settings = {
  accountBalance: 2500,
  assetFees: {},
  tradingSystems: [],
  tradingSessions: [],
  riskDeviationTolerance: 10,
  systemIdealRisk: {},
  defaultIdealRisk: 100,
}

// ============================================================ MIGRATION

console.log("--- migration ---")
{
  const legacyTrades = [trade({ accountId: undefined, pnl: 55 }), trade({ accountId: undefined, pnl: -20 })]
  const legacyAdjustments = [adjustment({ id: "a1", amount: 700, reason: "Deposit" })]

  const first = ensureAccountsMigration({
    trades: legacyTrades,
    settings,
    balanceAdjustments: legacyAdjustments,
    accounts: [],
  })

  assert(first.accounts.length === 1, "1: default account created")
  assert(first.accounts[0].id === DEFAULT_ACCOUNT_ID, "1: default account uses fixed id")
  assert(first.accounts[0].name === "Default Account", "1: default account named 'Default Account'")
  assertClose(first.accounts[0].startingBalance, 2500, "1: starting balance preserves settings.accountBalance")

  assert(first.trades.every((t) => t.accountId === DEFAULT_ACCOUNT_ID), "1: legacy trades -> Default Account")
  assertClose(first.trades[0].pnl, 55, "1: trade pnl unchanged")
  assertClose(first.trades[1].pnl, -20, "1: second trade pnl unchanged")
  assert(first.trades[0].asset === "TEST", "1: trade asset unchanged")
  assert(first.balanceAdjustments[0].accountId === DEFAULT_ACCOUNT_ID, "1: legacy adjustment -> Default Account")
  assertClose(first.balanceAdjustments[0].amount, 700, "1: adjustment amount unchanged")

  const second = ensureAccountsMigration({
    trades: first.trades,
    settings,
    balanceAdjustments: first.balanceAdjustments,
    accounts: first.accounts,
  })
  assert(second.accounts.length === 1, "2: idempotent - still one account")
  assert(second.trades === first.trades, "2: idempotent - no trade rewrite on second run")
  assert(second.balanceAdjustments === first.balanceAdjustments, "2: idempotent - no adjustment rewrite")
  assert(second.didMigrate === false, "2: idempotent - didMigrate false on second run")

  const third = ensureAccountsMigration({
    trades: second.trades,
    settings,
    balanceAdjustments: second.balanceAdjustments,
    accounts: second.accounts,
  })
  assert(third.accounts.length === 1, "3: running twice does not duplicate accounts")
}

{
  // Existing account + orphan trade: orphan goes to the default account.
  const custom = account({ id: "acc-custom", name: "Custom", startingBalance: 5000 })
  const orphan = trade({ accountId: undefined })
  const owned = trade({ accountId: "acc-custom" })
  const result = ensureAccountsMigration({
    trades: [orphan, owned],
    settings,
    balanceAdjustments: [],
    accounts: [custom],
  })
  assert(result.accounts.length === 2, "custom account preserved, default created for orphan")
  assert(result.accounts.some((a) => a.id === DEFAULT_ACCOUNT_ID), "default account present")
  assert(owned.accountId === "acc-custom", "owned trade untouched")
  assert(result.trades.find((t) => t.id === orphan.id)?.accountId === DEFAULT_ACCOUNT_ID, "orphan -> Default Account")
}

// ============================================================ ANALYTICS

console.log("--- analytics: two accounts (A=10000, B=40000) ---")
{
  const accA = account({ id: "acc-a", name: "Account A", startingBalance: 10000 })
  const accB = account({ id: "acc-b", name: "Account B", startingBalance: 40000 })

  const tradeA1 = trade({ id: "a1", accountId: "acc-a", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "12:00", pnl: 200 })
  const tradeA2 = trade({ id: "a2", accountId: "acc-a", date: "2026-01-06", time: "10:00", endDate: "2026-01-06", endTime: "12:00", pnl: -100 })
  const tradeB1 = trade({ id: "b1", accountId: "acc-b", date: "2026-01-05", time: "14:00", endDate: "2026-01-05", endTime: "16:00", pnl: 2000 })

  const allTrades = [tradeA1, tradeA2, tradeB1]
  const noAdjustments: BalanceAdjustment[] = []

  // Individual account P&L
  assertClose(getAccountNetTradingPnL("acc-a", allTrades), 100, "A net P&L = 100")
  assertClose(getAccountNetTradingPnL("acc-b", allTrades), 2000, "B net P&L = 2000")

  // Aggregate P&L
  assertClose(calculateScopeAdjustedBalance({ kind: "all" }, [accA, accB], allTrades, noAdjustments), 52100, "aggregate balance = 10000+40000+100+2000")

  // Individual balances
  assertClose(getAccountBalance(accA, allTrades, noAdjustments), 10100, "A balance = 10100")
  assertClose(getAccountBalance(accB, allTrades, noAdjustments), 42000, "B balance = 42000")

  // Individual daily returns
  const seriesA = buildAccountDailySeries(accA, allTrades, noAdjustments)
  assertClose(seriesA.points[0].returnPct, 2, "A day1 return = 2% (200/10000)")
  assertClose(seriesA.points[1].returnPct, -100 / 10200 * 100, "A day2 return = -100/10200")

  const seriesB = buildAccountDailySeries(accB, allTrades, noAdjustments)
  assertClose(seriesB.points[0].returnPct, 5, "B day1 return = 5% (2000/40000)")

  // Aggregate capital-weighted return: NOT the simple average (4.4% vs 3.5%)
  const aggregate = buildAggregateDailySeries([accA, accB], allTrades, noAdjustments)
  assertClose(aggregate.points[0].returnPct, 4.4, "aggregate day1 = 2200/50000 = 4.4% (capital-weighted)")
  assert(Math.abs(aggregate.points[0].returnPct - 3.5) > 0.1, "aggregate day1 is NOT the simple average (3.5%)")
  assertClose(aggregate.points[1].returnPct, -100 / 10200 * 100, "aggregate day2 = -100/10200 (A only)")

  // Account-specific Sharpe / Sortino / drawdown
  const metricsA = calculateScopeQuantMetrics({ trades: allTrades, scope: { kind: "selected", accountIds: ["acc-a"] }, accounts: [accA, accB] })
  const metricsB = calculateScopeQuantMetrics({ trades: allTrades, scope: { kind: "selected", accountIds: ["acc-b"] }, accounts: [accA, accB] })
  const metricsAll = calculateScopeQuantMetrics({ trades: allTrades, scope: { kind: "all" }, accounts: [accA, accB] })

  assert(metricsA.totalTrades === 2, "A closed trades = 2")
  assert(metricsB.totalTrades === 1, "B closed trades = 1")
  assert(metricsAll.totalTrades === 3, "All closed trades = 3")

  assert(metricsA.sharpeRatio !== null && Number.isFinite(metricsA.sharpeRatio), "A sharpe computed")
  assert(metricsB.sharpeRatio === null, "B sharpe null (single observation)")
  assert(metricsAll.sharpeRatio !== null && Number.isFinite(metricsAll.sharpeRatio), "aggregate sharpe computed")
  assert(metricsAll.sharpeRatio !== metricsA.sharpeRatio, "aggregate sharpe differs from A sharpe")

  // Drawdowns
  const ddA = calculateDrawdown([tradeA1, tradeA2], 10000)
  assertClose(ddA.maxDrawdownAmount, -100, "A drawdown amount -100")
  assertClose(ddA.maxDrawdownPct, -100 / 10200 * 100, "A drawdown pct -0.98%")

  const ddB = calculateDrawdown([tradeB1], 40000)
  assertClose(ddB.maxDrawdownAmount, 0, "B drawdown amount 0")
  assert(ddB.maxDrawdownPct === null, "B drawdown pct null (no peak-to-trough)")

  const ddAll = calculateScopeQuantMetrics({ trades: allTrades, scope: { kind: "all" }, accounts: [accA, accB] })
  assertClose(ddAll.maxDrawdownAmount, -100, "aggregate drawdown amount -100")
  assertClose(ddAll.maxDrawdownPct, -100 / 52200 * 100, "aggregate drawdown pct -0.19%")
}

// ============================================ IDLE CAPITAL PARTICIPATION

console.log("--- aggregate participation: idle capital is portfolio capital ---")
{
  // A: $10k, starts Jan 1, NO trade until March (idle during February).
  // B: $40k, starts Jan 1, +$4k on Feb 10.
  // C: $50k, starts March 1 -> must NOT enter the February denominator.
  const accA = account({ id: "acc-a", name: "A", startingBalance: 10000, startingDate: "2026-01-01" })
  const accB = account({ id: "acc-b", name: "B", startingBalance: 40000, startingDate: "2026-01-01" })
  const accC = account({ id: "acc-c", name: "C", startingBalance: 50000, startingDate: "2026-03-01" })

  const tradeB = trade({ id: "b-feb", accountId: "acc-b", date: "2026-02-10", time: "10:00", endDate: "2026-02-10", endTime: "12:00", pnl: 4000 })
  const tradeA = trade({ id: "a-mar", accountId: "acc-a", date: "2026-03-05", time: "10:00", endDate: "2026-03-05", endTime: "12:00", pnl: 500 })
  const tradeC = trade({ id: "c-mar", accountId: "acc-c", date: "2026-03-10", time: "10:00", endDate: "2026-03-10", endTime: "12:00", pnl: 1000 })
  const allTrades = [tradeA, tradeB, tradeC]

  const aggregate = buildAggregateDailySeries([accA, accB, accC], allTrades, [])
  const feb10 = aggregate.points.find((point) => point.date === "2026-02-10")

  assert(feb10 !== undefined, "aggregate series includes Feb 10")
  if (feb10) {
    assertClose(feb10.returnPct, 8, "Feb 10 return = 4000/50000 = 8% (idle A counts in the denominator)")
    assert(Math.abs(feb10.returnPct - 10) > 0.1, "Feb 10 return is NOT 10% (4000/40000)")
    assertClose(feb10.tradingEquityStart, 50000, "Feb 10 denominator = A(10000) + B(40000) = 50000")
  }
  assertClose(aggregate.points[0].tradingEquityStart, 50000, "series starts Jan 1 with A+B capital (C absent)")
  assertClose(aggregate.points[0].realizedPnl, 0, "no realized P&L until Feb 10")

  // C enters only from March 1.
  const mar1 = aggregate.points.find((point) => point.date === "2026-03-01")
  if (mar1) {
    assertClose(mar1.tradingEquityStart, 100000, "March 1 denominator includes C (50000)")

    // B's Feb P&L is not diluted out of existence, and C's March capital is
    // not silently dropped from the February return.
    assertClose(aggregate.points.reduce((sum, point) => sum + point.realizedPnl, 0), 5500, "aggregate realized P&L = 4000+500+1000")
  }

  // Idle-only account (no closed trades yet) with a valid startingDate also
  // counts toward the denominator from its start date.
  const idleD = account({ id: "acc-d", name: "D", startingBalance: 10000, startingDate: "2026-01-15" })
  const withIdle = buildAggregateDailySeries([accA, accB, accC, idleD], allTrades, [])
  const feb10WithIdle = withIdle.points.find((point) => point.date === "2026-02-10")
  if (feb10WithIdle) {
    assertClose(feb10WithIdle.tradingEquityStart, 60000, "idle-only D (10000) joins the Feb 10 denominator")
    assertClose(feb10WithIdle.returnPct, 4000 / 60000 * 100, "Feb 10 return = 4000/60000 with idle D")
  }
}

// ==================================== INCONSISTENT STARTING DATE POLICY

console.log("--- startingDate later than historical trades (inconsistent) ---")
{
  // D has startingDate AFTER its first real trade. Effective participation
  // must start at the first close so the earlier performance is NOT dropped.
  const accD = account({ id: "acc-d", name: "D", startingBalance: 20000, startingDate: "2026-06-01" })
  const tradeEarly = trade({ id: "d-may", accountId: "acc-d", date: "2026-05-20", time: "10:00", endDate: "2026-05-20", endTime: "12:00", pnl: -500 })

  const series = buildAccountDailySeries(accD, [tradeEarly], [])
  assertClose(series.points[0].date === "2026-05-20" ? series.points[0].returnPct : NaN, -500 / 20000 * 100, "D's curve starts at first close (May 20), not startingDate (June 1)")

  const aggregate = buildAggregateDailySeries([accD], [tradeEarly], [])
  assertClose(aggregate.points[0].realizedPnl, -500, "earlier-than-startingDate P&L is not discarded in the aggregate")
  assertClose(aggregate.points[0].tradingEquityStart, 20000, "D's capital participates from the first close")

  // Metrics route (same series feeds Sharpe / Sortino / drawdown).
  const metrics = calculateScopeQuantMetrics({ trades: [tradeEarly], scope: { kind: "selected", accountIds: ["acc-d"] }, accounts: [accD] })
  assert(metrics.totalTrades === 1, "inconsistent-startingDate account still counts its closed trade")
  assert(metrics.maxDrawdownAmount !== 0, "drawdown reflects the early realized loss")
}

// ============================================================ BALANCE DEFAULTS

console.log("--- balance defaults: scoped balance falls back to the account ---")
{
  const accA = account({ id: "acc-a", name: "A", startingBalance: 10000 })
  const accB = account({ id: "acc-b", name: "B", startingBalance: 40000 })

  // No trades, no adjustments: real balance defaults to the account's starting
  // balance (NOT the legacy settings.accountBalance fallback).
  assertClose(getAccountBalance(accA, [], []), 10000, "A: idle balance = its startingBalance (10000), not settings (2500)")
  assertClose(getAccountBalance(accB, [], []), 40000, "B: idle balance = 40000")

  // Scope-adjusted balance with no activity = sum of scoped starting balances.
  assertClose(calculateScopeAdjustedBalance({ kind: "all" }, [accA, accB], [], []), 50000, "All: idle aggregate = 10000 + 40000")

  const scopeA: AccountScope = { kind: "selected", accountIds: ["acc-a"] }
  assertClose(calculateScopeAdjustedBalance(scopeA, [accA, accB], [], []), 10000, "A: idle scoped balance = 10000")

  // With only flows (no trades) the default still holds + flows.
  const deposit = adjustment({ id: "d1", accountId: "acc-a", amount: 500, type: "add", date: "2026-01-02" })
  assertClose(getAccountBalance(accA, [], [deposit]), 10500, "A: startingBalance + deposit = 10500")

  // Open trades never count toward the realized P&L default.
  const openOnly = trade({ id: "o1", accountId: "acc-a", endDate: undefined, pnl: 9999 })
  assertClose(getAccountBalance(accA, [openOnly], []), 10000, "A: open trade excluded -> balance stays 10000")

  // The account daily series also starts from the account's own startingBalance.
  const series = buildAccountDailySeries(accA, [], [])
  assert(series.points.length === 0, "A: no closed trades -> empty series (default handled at balance level)")
}

// ============================================================ FILTERING

console.log("--- account filtering ---")
{
  const accA = account({ id: "acc-a", name: "A", startingBalance: 10000 })
  const accB = account({ id: "acc-b", name: "B", startingBalance: 20000 })
  const tA = trade({ id: "a1", accountId: "acc-a", pnl: 100 })
  const tB = trade({ id: "b1", accountId: "acc-b", pnl: 300 })
  const tOpen = trade({ id: "o1", accountId: "acc-a", endDate: undefined, pnl: 0 })
  const allTrades = [tA, tB, tOpen]

  const scopeAll: AccountScope = { kind: "all" }
  const scopeA: AccountScope = { kind: "selected", accountIds: ["acc-a"] }
  const scopeB: AccountScope = { kind: "selected", accountIds: ["acc-b"] }

  assert(filterTradesByScope(allTrades, scopeAll).length === 3, "All Accounts -> all trades")
  assert(filterTradesByScope(allTrades, scopeA).length === 2, "A only -> A trades (closed + open)")
  assert(filterTradesByScope(allTrades, scopeB).length === 1, "B only -> B trade")

  const before = JSON.stringify(allTrades)
  filterTradesByScope(allTrades, scopeA)
  filterTradesByScope(allTrades, scopeAll)
  assert(JSON.stringify(allTrades) === before, "filtering does not mutate the trade array")
  assert(allTrades[0].pnl === 100, "trade values unchanged after filtering")

  const metricsA = calculateScopeQuantMetrics({ trades: allTrades, scope: scopeA, accounts: [accA, accB] })
  const metricsAll = calculateScopeQuantMetrics({ trades: allTrades, scope: scopeAll, accounts: [accA, accB] })
  assert(metricsA.totalTrades === 1, "A closed count excludes open trade")
  assert(metricsA.openTrades === 1, "A open count = 1")
  assert(metricsAll.totalTrades === 2, "All closed count excludes open trade")
  assert(metricsA.winningTrades !== metricsAll.winningTrades, "changing scope changes KPI results")

  // Open trade stays excluded from closed-performance metrics even in All.
  assert(metricsAll.breakevenTrades === 0, "open trade is not a breakeven")
  assertClose(metricsAll.winRate, 100, "win rate of two closed winners = 100%")
}

// ============================================================ DUPLICATES

console.log("--- import duplicates ---")
{
  const accA = account({ id: "acc-a", name: "A", startingBalance: 10000 })
  const accB = account({ id: "acc-b", name: "B", startingBalance: 10000 })

  const base = trade({ id: "t1", accountId: "acc-a", ticket: "ORD-100", asset: "TSLA", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "15:00", entryPrice: 300, exitPrice: 320, positionSize: 5, pnl: 100 })
  const incomingSameAccount = trade({ accountId: "acc-a", ticket: "ORD-100", asset: "TSLA", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "15:00", entryPrice: 300, exitPrice: 320, positionSize: 5, pnl: 100 })
  const incomingOtherAccount = trade({ accountId: "acc-b", ticket: "ORD-100", asset: "TSLA", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "15:00", entryPrice: 300, exitPrice: 320, positionSize: 5, pnl: 100 })

  const sameAccount = detectDuplicates([base], [incomingSameAccount])
  assert(sameAccount.duplicates.length === 1, "same trade + same account -> duplicate")
  assert(sameAccount.newTrades.length === 0, "same trade + same account -> no new")

  const otherAccount = detectDuplicates([base], [incomingOtherAccount])
  assert(otherAccount.newTrades.length === 1, "same trade + different account -> NOT duplicate")
  assert(otherAccount.duplicates.length === 0, "same trade + different account -> no duplicate")

  // Import the same file twice.
  const firstImport = detectDuplicates([], [base])
  assert(firstImport.newTrades.length === 1, "first import: 1 new")
  const afterFirst = [base]
  const secondImport = detectDuplicates(afterFirst, [incomingSameAccount])
  assert(secondImport.newTrades.length === 0, "second import: no new trades")
  assert(secondImport.duplicates.length === 1, "second import: 1 duplicate skipped")

  // Signature includes account.
  const sigA = buildTradeSignature({ ...base, id: "x" })
  const sigB = buildTradeSignature({ ...incomingOtherAccount, id: "y" })
  assert(sigA !== sigB, "duplicate signature differs across accounts")
}

// Regression: the import dialog assigns accountId BEFORE dedupe. Raw converter
// output has no accountId, so dedupe on un-stamped trades would never match a
// stored trade (its signature includes accountId) and re-importing the same
// file would double-import.
{
  const stored = trade({ id: "t1", accountId: "acc-a", ticket: "ORD-100", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "15:00" })
  // Exactly what convertBrokerTradeToTrade/convertFidelityRoundTripToTrade emit:
  // no accountId yet.
  const rawIncoming = trade({ accountId: undefined, ticket: "ORD-100", date: "2026-01-05", time: "10:00", endDate: "2026-01-05", endTime: "15:00" })

  const buggy = detectDuplicates([stored], [rawIncoming])
  assert(buggy.duplicates.length === 0, "un-stamped incoming does not match stored trade (documents the ordering requirement)")

  const stampedIncoming = { ...rawIncoming, accountId: "acc-a" }
  const fixed = detectDuplicates([stored], [stampedIncoming])
  assert(fixed.duplicates.length === 1, "stamped incoming same account -> duplicate skipped")
  assert(fixed.newTrades.length === 0, "stamped incoming same account -> no new trade")

  const stampedOther = { ...rawIncoming, accountId: "acc-b" }
  const other = detectDuplicates([stored], [stampedOther])
  assert(other.newTrades.length === 1, "stamped incoming other account -> NOT duplicate")
}

// ============================================================ SETUP / NOTES / STOPS

console.log("--- setup / manual grade / notes / stops ---")
{
  // Fields persist on the trade object.
  const reviewed = trade({
    id: "r1",
    accountId: "acc-a",
    setupId: "setup-breakout",
    manualSetupGrade: "A+",
    manualProcessFollowed: true,
    tradeThesis: "expect continuation after breakout",
    reviewNotes: "clean fill, tight stop",
    stopLoss: 95,
  })
  assert(reviewed.setupId === "setup-breakout", "setup persists")
  assert(reviewed.manualSetupGrade === "A+", "manual grade persists")
  assert(reviewed.tradeThesis === "expect continuation after breakout", "thesis persists")
  assert(reviewed.reviewNotes === "clean fill, tight stop", "review notes persist")

  // Manual stop persists and is marked manual.
  const withManualStop = applyStopInfo(trade({ stopLoss: 95, entryPrice: 100, pnl: 60 }))
  assertClose(getManualStopPct(withManualStop), 5, "manual stop pct = 5% (|100-95|/100)")
  assert(withManualStop.stopSource === "manual", "manual stop source = manual")
  assertClose(withManualStop.plannedStopPrice, 95, "plannedStopPrice mirrors stopLoss")
  assert(withManualStop.inferredStopPct === undefined, "no inferred stop on manual stop")

  // Losing trade with no manual stop -> inferred from realized loss.
  const losingNoStop = applyStopInfo(trade({ stopLoss: 0, entryPrice: 100, positionSize: 10, pnl: -70 }))
  assertClose(getRealizedLossPct(losingNoStop), 7, "realized loss pct = 7%")
  assert(losingNoStop.stopSource === "inferred", "inferred stop source = inferred")
  assertClose(getEffectiveStopPct(losingNoStop), 7, "inferred planned stop pct = 7%")
  assertClose(losingNoStop.inferredStopPct, 7, "inferredStopPct recorded = 7%")
  assert(losingNoStop.plannedStopPrice === undefined, "inferred stop is distinguishable (no plannedStopPrice)")

  // Manual override wins over inferred.
  const overridden = applyStopInfo(trade({ stopLoss: 95, entryPrice: 100, positionSize: 10, pnl: -70 }))
  assert(overridden.stopSource === "manual", "manual override wins (source)")
  assertClose(getEffectiveStopPct(overridden), 5, "manual override wins (5% not 7%)")

  // Closed breakeven is NOT a losing stop.
  const breakeven = applyStopInfo(trade({ stopLoss: 0, entryPrice: 100, positionSize: 10, pnl: 0 }))
  assert(!isClosedLoss(breakeven), "closed breakeven is not a losing stop")
  assert(isBreakeven(breakeven), "closed breakeven detected")
  assert(breakeven.stopSource === "none", "breakeven with no manual stop -> none")

  // Open trade does NOT receive an inferred realized-loss stop.
  const open = applyStopInfo(trade({ endDate: undefined, stopLoss: 0, entryPrice: 100, positionSize: 10, pnl: -999 }))
  assert(!isTradeClosed(open), "open trade is not closed")
  assert(open.stopSource === "none", "open trade -> no inferred stop")
  assert(open.inferredStopPct === undefined, "open trade has no inferred stop pct")

  // needsReview criteria.
  const incomplete = trade({ accountId: "acc-a", setupId: undefined, manualSetupGrade: undefined, stopLoss: 0, pnl: -50, reviewNotes: undefined })
  assert(needsReview(incomplete), "closed trade missing review info -> needs review")
  assert(!needsReview(open), "open trade never needs review")
  assert(!needsReview(reviewed), "fully reviewed trade does not need review")
  assert(getReviewStatusLabel(reviewed) === "Reviewed", "review label: Reviewed")
  assert(getReviewStatusLabel(open) === "Open", "review label: Open")
}

console.log("")
if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`)
  process.exit(1)
} else {
  console.log(`${passed} passed, 0 failed`)
}
