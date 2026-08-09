/**
 * Deterministic tests for the import account workflow:
 * - automatic starting date rule (earliest entry date, else earliest close date, else none)
 * - new-account spec validation (name required, balance >= 0, no NaN/Infinity)
 * - destination resolution: NO silent Default Account fallback for new imports
 * - starting balance is BASELINE equity: not P&L, not a deposit, not an
 *   adjustment, not a profit-factor contribution
 * - account creation atomicity: no account from an unparseable/invalid import
 * - broker data without stop/ideal-risk imports WITHOUT fabricated risk values
 *
 * Run with: npm run test:import
 */
import type { Settings, Trade } from "../types/trade.ts"
import type { TradingAccount } from "../types/account.ts"
import {
  DEFAULT_ACCOUNT_ID,
} from "../utils/account-migration.ts"
import {
  computeAccountStartingDate,
  validateNewAccountSpec,
  buildImportAccount,
  prepareImport,
  stampAccountId,
  type NewAccountSpec,
  type ImportDestination,
} from "../utils/import-account.ts"
import { parseFidelityCsv } from "../lib/fidelity-parser.ts"
import { convertFidelityRoundTripToTrade } from "../lib/fidelity-to-trade.ts"
import type { FidelityRoundTrip } from "../lib/fidelity-parser.ts"
import { applyStopInfo } from "../utils/trade-review.ts"
import { calculateNetTradingPnL, calculateQuantMetrics } from "../utils/quant-metrics.ts"

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

let sequence = 0
function trade(overrides: Partial<Trade> = {}): Trade {
  sequence += 1
  return {
    id: overrides.id || `trade-${sequence}`,
    date: "2025-01-10",
    time: "10:00",
    endDate: "2025-01-20",
    endTime: "15:00",
    asset: "TEST",
    tradeType: "Long",
    entryPrice: 100,
    exitPrice: 110,
    stopLoss: 0,
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
    system: "Fidelity",
    timeframe: "",
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

const settings: Settings = {
  accountBalance: 10000,
  assetFees: {},
  tradingSystems: [],
  tradingSessions: [],
  riskDeviationTolerance: 10,
  systemIdealRisk: {},
  defaultIdealRisk: 100,
}

function spec(overrides: Partial<NewAccountSpec> = {}): NewAccountSpec {
  return { name: "Fidelity Main", broker: "Fidelity", startingBalance: 100000, currency: "USD", ...overrides }
}

function roundTrip(overrides: Partial<FidelityRoundTrip> = {}): FidelityRoundTrip {
  return {
    symbol: "AAPL",
    openDate: "2025-01-10",
    openTime: "10:00",
    closeDate: "2025-01-20",
    closeTime: "15:00",
    shares: 100,
    avgEntryPrice: 100,
    avgExitPrice: 110,
    pnl: 1000,
    fee: 2,
    ticket: "AAPL|2025-01-10|2025-01-20|100",
    ...overrides,
  }
}

// ============================================================ STARTING DATE

console.log("--- computeAccountStartingDate ---")
{
  assert(
    computeAccountStartingDate([trade({ date: "2025-01-10", endDate: "2025-01-20" })]) === "2025-01-10",
    "entry date is used, not the close date (2025-01-10 not 2025-01-20)",
  )
  assert(
    computeAccountStartingDate([
      trade({ date: "2025-03-01" }),
      trade({ date: "2025-01-05" }),
      trade({ date: "2025-02-10" }),
    ]) === "2025-01-05",
    "multiple trades -> earliest valid entry date",
  )
  assert(
    computeAccountStartingDate([trade({ date: "", endDate: "2025-02-01" })]) === "2025-02-01",
    "no usable entry date -> earliest close date",
  )
  assert(
    computeAccountStartingDate([trade({ date: "2025-03-01", endDate: "2025-01-01" })]) === "2025-03-01",
    "close before entry still yields the entry date when present (entry preferred)",
  )
  assert(
    computeAccountStartingDate([trade({ date: "", endDate: "" })]) === undefined,
    "no usable dates -> undefined (never fabricate a date)",
  )
  assert(
    computeAccountStartingDate([trade({ date: "not-a-date", endDate: "2025-02-01" })]) === "2025-02-01",
    "invalid entry date skipped, valid close date used",
  )
  assert(computeAccountStartingDate([]) === undefined, "empty trades -> undefined")
}

// ============================================================ VALIDATION

console.log("--- validateNewAccountSpec ---")
assert(validateNewAccountSpec(spec()) === null, "valid spec passes")
assert(validateNewAccountSpec(spec({ name: "   " })) !== null, "whitespace-only name rejected")
assert(validateNewAccountSpec(spec({ name: "" })) !== null, "empty name rejected")
assert(validateNewAccountSpec(spec({ startingBalance: Number.NaN })) !== null, "NaN balance rejected")
assert(validateNewAccountSpec(spec({ startingBalance: Number.POSITIVE_INFINITY })) !== null, "Infinity balance rejected")
assert(validateNewAccountSpec(spec({ startingBalance: -1 })) !== null, "negative balance rejected")
assert(validateNewAccountSpec(spec({ startingBalance: 0 })) === null, "zero balance allowed (>= 0)")

// ============================================================ DESTINATION / ATOMICITY

console.log("--- prepareImport: destinations ---")
{
  const existingAccounts = [
    account({ id: DEFAULT_ACCOUNT_ID, name: "Default Account" }),
    account({ id: "acc-fm", name: "Fidelity Main", startingBalance: 50000 }),
  ]
  const incoming = [trade({})]

  const existing = prepareImport({
    trades: incoming,
    destination: { kind: "existing", accountId: "acc-fm" },
    existingAccounts,
  })
  assert(existing.ok === true && existing.trades.every((t) => t.accountId === "acc-fm"), "existing account -> trades stamped to that account id")
  assert(existing.ok === true && existing.account === undefined, "existing account -> no account created")

  const missing = prepareImport({
    trades: incoming,
    destination: { kind: "existing", accountId: "" },
    existingAccounts,
  })
  assert(missing.ok === false, "no destination selected -> import blocked (no silent default)")
  assert(missing.ok === false && (missing as any).account === undefined, "blocked import -> no account left behind")

  const ghost = prepareImport({
    trades: incoming,
    destination: { kind: "existing", accountId: "ghost-account" },
    existingAccounts,
  })
  assert(ghost.ok === false, "unknown destination account -> import blocked")

  const created = prepareImport({
    trades: incoming,
    destination: { kind: "new", accountId: "new-acc-1", spec: spec({ name: "  Fidelity Main  " }) },
    existingAccounts,
  })
  assert(created.ok === true && created.account?.name === "Fidelity Main", "new account -> name trimmed")
  assert(created.ok === true && created.account?.id === "new-acc-1", "new account -> stable generated id used")
  assert(created.ok === true && created.account?.id !== DEFAULT_ACCOUNT_ID, "new account -> NEVER Default Account")
  assert(created.ok === true && created.trades.every((t) => t.accountId === "new-acc-1"), "new account -> all trades reference its id")

  const invalidNew = prepareImport({
    trades: incoming,
    destination: { kind: "new", accountId: "new-acc-2", spec: spec({ name: "", startingBalance: Number.NaN }) },
    existingAccounts,
  })
  assert(invalidNew.ok === false, "invalid new-account spec -> import blocked")
  assert(invalidNew.ok === false && (invalidNew as any).account === undefined, "invalid new-account spec -> no empty account")
}

// ============================================================ STARTING BALANCE SEMANTICS (Test 15)

console.log("--- starting balance is baseline equity, not P&L/deposit/adjustment ---")
{
  const trades = [trade({ id: "a", date: "2025-01-10", endDate: "2025-01-20", pnl: 3000 }), trade({ id: "b", date: "2025-02-01", endDate: "2025-02-05", pnl: 2000 })]
  const prepared = prepareImport({
    trades,
    destination: { kind: "new", accountId: "acc-fm", spec: spec({ startingBalance: 100000 }) },
    existingAccounts: [],
  })
  assert(prepared.ok === true, "successful import prepares one account")
  if (prepared.ok) {
    assert(prepared.account.startingBalance === 100000, "startingBalance = 100000")
    assert(prepared.account.startingDate === "2025-01-10", "startingDate = earliest entry (2025-01-10)")
    const netPnl = calculateNetTradingPnL(prepared.trades as Trade[])
    assert(netPnl === 5000, `realized trading P&L = +5000 (got ${netPnl})`)
    const balanceBeforeAdjustments = prepared.account.startingBalance + netPnl
    assert(balanceBeforeAdjustments === 105000, `account balance before external adjustments = 105000 (got ${balanceBeforeAdjustments})`)
    assert((prepared as any).balanceAdjustments === undefined, "starting balance is NOT modeled as a balance adjustment")
    const pnlSum = prepared.trades.reduce((s, t) => s + t.pnl, 0)
    assert(pnlSum === 5000, "the $100,000 never leaks into trade P&L")
    const pf100k = calculateQuantMetrics(prepared.trades as Trade[], { startingBalance: 100000 }).profitFactor
    const pf1 = calculateQuantMetrics(prepared.trades as Trade[], { startingBalance: 1 }).profitFactor
    assert(pf100k === pf1, "starting balance does NOT contribute to profit factor")
  }
}

// ============================================================ ATOMICITY (Test 17)

console.log("--- atomic account creation ---")
{
  const badCsv = "this is not a fidelity history file at all"
  let threw = false
  try {
    parseFidelityCsv(badCsv)
  } catch {
    threw = true
  }
  assert(threw, "unimportable CSV fails parsing (before any account is created)")

  // A new account only comes into existence from a VALID, fully parsed import.
  const prepared = prepareImport({
    trades: [trade({})],
    destination: { kind: "new", accountId: "acc-atomic", spec: spec() },
    existingAccounts: [],
  })
  assert(prepared.ok === true && prepared.account?.id === "acc-atomic", "successful import -> account created exactly once")
  assert(prepared.ok === true && prepared.trades.every((t) => t.accountId === "acc-atomic"), "successful import -> every trade references the created id")
}

// ============================================================ NO FABRICATED RISK (Test 19)

console.log("--- no fabricated stop / ideal risk during Fidelity import ---")
{
  const win = convertFidelityRoundTripToTrade(roundTrip({ pnl: 1000 }), { settings })
  assert(win.stopLoss === 0, "no fabricated stop loss for a winning trade")
  assert(win.idealRiskAmount === 0, "no fabricated ideal risk amount")
  assert(win.riskAmount === 0, "no fabricated risk amount (got " + win.riskAmount + ")")
  assert(win.expectedR === 0, "no fabricated expected R")
  assert(win.isOverRisked === false && win.isUnderRisked === false, "no fabricated risk flags")

  const stampedWin = applyStopInfo(win as Trade)
  assert(stampedWin.stopSource === "none", "winning trade -> no invented stop (stopSource none)")
  assert(stampedWin.plannedStopPct === undefined, "winning trade -> no invented stop distance")

  const loss = applyStopInfo(convertFidelityRoundTripToTrade(roundTrip({ pnl: -500, avgExitPrice: 95 }), { settings }) as Trade)
  assert(loss.stopSource === "inferred", "losing trade WITHOUT a stop keeps the canonical inferred stop")
  assert(loss.plannedStopPct !== undefined && loss.plannedStopPct > 0, "inferred stop recorded for the losing trade")

  const breakeven = applyStopInfo(convertFidelityRoundTripToTrade(roundTrip({ pnl: 0, avgExitPrice: 100 }), { settings }) as Trade)
  assert(breakeven.stopSource === "none", "breakeven trade -> no invented stop")
}

// ============================================================ STAMP ACCOUNT ID

console.log("--- stampAccountId ---")
{
  const raw: Array<{ accountId?: string }> = [{ accountId: undefined }, { accountId: undefined }]
  const stamped = stampAccountId(raw, "acc-x")
  assert(stamped.every((t) => t.accountId === "acc-x"), "stamps every trade with the destination id")
  assert(raw.every((t) => t.accountId === undefined), "does not mutate the input trades")
}

console.log(`\nimport-account: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
