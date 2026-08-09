/**
 * Deterministic tests for the versioned full-journal backup/restore:
 * - build -> serialize -> parse round-trip preserves every entity and stable id
 * - legacy trade-only JSON is detected as legacy, NOT a full backup
 * - the ENTIRE backup is validated before restore; dangling references, invalid
 *   shapes, duplicate ids, and future schema versions are rejected atomically
 * - validation never mutates its input
 * - restored scope normalization (empty/unknown selected ids -> All Accounts)
 *
 * Run with: npm run test:backup
 */
import type { BalanceAdjustment, Settings, Trade } from "../types/trade.ts"
import type { AccountScope, TradingAccount } from "../types/account.ts"
import type { Setup } from "../types/setup.ts"
import { DEFAULT_SETUPS } from "../types/setup.ts"
import { CURRENT_SCHEMA_VERSION } from "../utils/account-migration.ts"
import {
  buildFullBackup,
  serializeFullBackup,
  parseBackup,
  validateBackup,
  normalizeRestoredScope,
} from "../lib/export-import.ts"

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
    accountId: overrides.accountId || "acc-a",
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
    accountId: "acc-a",
    amount: 500,
    reason: "Deposit",
    type: "add",
    date: "2026-01-02",
    time: "00:00",
    ...overrides,
  }
}

const settings: Settings = {
  accountBalance: 25000,
  assetFees: { BTC: 16 },
  tradingSystems: ["Breakout"],
  tradingSessions: [
    { name: "London", startTime: "07:00", endTime: "12:59", color: "#10B981", description: "London Session" },
  ],
  riskDeviationTolerance: 10,
  systemIdealRisk: {},
  defaultIdealRisk: 1,
}

function buildGoodBackup(): { backupText: string } {
  const accA = account({ id: "acc-a", name: "Alpha", startingBalance: 10000, startingDate: "2026-01-01" })
  const accB = account({ id: "acc-b", name: "Beta", startingBalance: 40000, broker: "Fidelity", startingDate: "2026-02-01" })
  const customSetup: Setup = { id: "setup-custom-1", name: "My Pullback", builtIn: false }
  const setups = [...DEFAULT_SETUPS, customSetup]
  const t1 = trade({
    id: "t1",
    accountId: "acc-a",
    setupId: "setup-custom-1",
    manualSetupGrade: "A",
    manualProcessFollowed: true,
    manualMistakeIds: ["mistake-chased-entry"],
    tradeThesis: "retest of range low",
    reviewNotes: "waited for confirmation",
    plannedStopPrice: 95,
    plannedStopPct: 5,
    stopSource: "manual",
  })
  const t2 = trade({ id: "t2", accountId: "acc-b", setupId: "setup-breakout", pnl: -40, outcome: "Loss" })
  const adj = adjustment({ id: "adj-1", accountId: "acc-b", amount: 1000, reason: "Withdrawal", type: "subtract" })
  const scope: AccountScope = { kind: "selected", accountIds: ["acc-a", "acc-b"] }
  const backup = buildFullBackup({
    accounts: [accA, accB],
    setups,
    trades: [t1, t2],
    balanceAdjustments: [adj],
    settings,
    accountScope: scope,
  })
  return { backupText: serializeFullBackup(backup) }
}

// ============================================================ ROUND TRIP

console.log("--- backup round-trip: stable ids and metadata ---")
{
  const { backupText } = buildGoodBackup()
  const parsed = parseBackup(backupText)

  assert(parsed.kind === "full", "serialized backup parses as a full backup")

  if (parsed.kind === "full") {
    const backup = parsed.backup
    assert(backup.schemaVersion === CURRENT_SCHEMA_VERSION, "backup carries the current schema version")
    assert(typeof backup.exportedAt === "string" && backup.exportedAt.length > 0, "exportedAt present")

    const validation = validateBackup(backup)
    assert(validation.ok, `valid backup passes whole-backup validation (${validation.errors.join("; ")})`)

    assert(backup.accounts.length === 2, "both accounts preserved")
    assert(backup.accounts.find((a) => a.id === "acc-a")?.startingDate === "2026-01-01", "account startingDate preserved")
    assert(backup.accounts.find((a) => a.id === "acc-b")?.broker === "Fidelity", "account broker preserved")

    assert(backup.setups.some((s) => s.id === "setup-custom-1" && !s.builtIn), "custom setup preserved (id + builtIn flag)")

    const rt = backup.trades.find((t) => t.id === "t1")
    assert(Boolean(rt), "trade t1 present")
    if (rt) {
      assert(rt.accountId === "acc-a", "trade.accountId preserved")
      assert(rt.setupId === "setup-custom-1", "trade.setupId preserved")
      assert(rt.manualSetupGrade === "A", "manual setup grade preserved")
      assert(rt.manualProcessFollowed === true, "process review preserved")
      assert(rt.manualMistakeIds?.[0] === "mistake-chased-entry", "review mistake ids preserved")
      assert(rt.tradeThesis === "retest of range low" && rt.reviewNotes === "waited for confirmation", "review notes preserved")
      assert(rt.plannedStopPrice === 95 && rt.plannedStopPct === 5, "planned stop preserved")
      assert(rt.stopSource === "manual", "stop source preserved")
      assert(rt.pnl === 100, "financial fields preserved")
    }
    assert(backup.trades.find((t) => t.id === "t2")?.accountId === "acc-b", "second trade account preserved")
    assert(backup.balanceAdjustments.length === 1, "adjustment preserved")
    assert(backup.balanceAdjustments[0].accountId === "acc-b" && backup.balanceAdjustments[0].amount === 1000, "adjustment account/amount preserved")
    assert(backup.settings.accountBalance === 25000, "settings preserved")
    assert(
      backup.accountScope.kind === "selected" &&
        (backup.accountScope as { accountIds: string[] }).accountIds.length === 2,
      "account scope preserved",
    )
  }
}

// ============================================================ LEGACY DETECTION

console.log("--- legacy vs full detection ---")
{
  const legacyArray = JSON.stringify([trade({ id: "lx1", accountId: "acc-a" })])
  const p1 = parseBackup(legacyArray)
  assert(p1.kind === "legacy", "plain trade array -> legacy (keeps import behavior)")

  const legacyObject = JSON.stringify({ trades: [trade({ id: "lx2", accountId: "acc-a" })], settings })
  const p2 = parseBackup(legacyObject)
  assert(p2.kind === "legacy", "trade export object -> legacy (keeps import behavior)")

  const p3 = parseBackup("this is not json {")
  assert(p3.kind === "invalid", "unparseable text -> invalid")

  const p4 = parseBackup('{ "foo": 1 }')
  assert(p4.kind === "invalid", "unrecognized object -> invalid")
}

// ============================================================ VALIDATION

console.log("--- whole-backup validation rejects bad data atomically ---")
{
  const { backupText } = buildGoodBackup()
  const good = JSON.parse(backupText) as { trades: Trade[]; accounts: TradingAccount[]; schemaVersion: number }

  // Dangling trade.accountId
  const bad1 = JSON.parse(backupText)
  bad1.trades.push(trade({ id: "td", accountId: "ghost-account" }))
  const v1 = validateBackup(bad1)
  assert(!v1.ok && v1.errors.some((e) => e.includes("ghost-account")), "dangling trade.accountId rejected")

  // Dangling trade.setupId
  const bad2 = JSON.parse(backupText)
  bad2.trades[0].setupId = "ghost-setup"
  const v2 = validateBackup(bad2)
  assert(!v2.ok && v2.errors.some((e) => e.includes("ghost-setup")), "dangling trade.setupId rejected")

  // Dangling adjustment.accountId
  const bad2b = JSON.parse(backupText)
  bad2b.balanceAdjustments[0].accountId = "ghost-adjustment"
  const v2b = validateBackup(bad2b)
  assert(!v2b.ok && v2b.errors.some((e) => e.includes("ghost-adjustment")), "dangling adjustment.accountId rejected")

  // Future schema version
  const bad3 = JSON.parse(backupText)
  bad3.schemaVersion = CURRENT_SCHEMA_VERSION + 1
  const v3 = validateBackup(bad3)
  assert(!v3.ok && v3.errors.some((e) => e.toLowerCase().includes("newer")), "future schemaVersion rejected (no downgrade)")

  // Missing accounts
  const bad4 = JSON.parse(backupText)
  delete bad4.accounts
  assert(!validateBackup(bad4).ok, "missing accounts rejected")

  // Duplicate account ids
  const bad5 = JSON.parse(backupText)
  bad5.accounts.push({ ...bad5.accounts[0], name: "Copy" })
  const v5 = validateBackup(bad5)
  assert(!v5.ok && v5.errors.some((e) => e.includes("Duplicate account id")), "duplicate account id rejected")

  // Duplicate trade ids
  const bad5b = JSON.parse(backupText)
  bad5b.trades.push({ ...bad5b.trades[0] })
  const v5b = validateBackup(bad5b)
  assert(!v5b.ok && v5b.errors.some((e) => e.includes("Duplicate trade id")), "duplicate trade id rejected")

  // Scope referencing a missing account
  const bad6 = JSON.parse(backupText)
  bad6.accountScope = { kind: "selected", accountIds: ["nope"] }
  const v6 = validateBackup(bad6)
  assert(!v6.ok && v6.errors.some((e) => e.toLowerCase().includes("scope")), "dangling scope account rejected")

  // Atomicity: validation never mutates the object it inspects
  const snapshot = JSON.stringify(bad1)
  validateBackup(bad1)
  assert(JSON.stringify(bad1) === snapshot, "validation does not mutate its input")
  assert(good.trades.length > 0 && good.accounts.length === 2, "original reference data still intact")
}

// ============================================================ SCOPE NORMALIZATION

console.log("--- restored scope normalization ---")
{
  const accounts = [
    account({ id: "acc-a", name: "A" }),
    account({ id: "acc-b", name: "B" }),
  ]

  const all = normalizeRestoredScope({ kind: "all" }, accounts)
  assert(all.kind === "all", "All Accounts stays All Accounts")

  const empty = normalizeRestoredScope({ kind: "selected", accountIds: [] }, accounts)
  assert(empty.kind === "all", "empty selected scope normalizes to All Accounts")

  const dropped = normalizeRestoredScope({ kind: "selected", accountIds: ["acc-a", "missing"] }, accounts)
  assert(dropped.kind === "selected" && dropped.accountIds.length === 1 && dropped.accountIds[0] === "acc-a", "unknown scope ids dropped")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
