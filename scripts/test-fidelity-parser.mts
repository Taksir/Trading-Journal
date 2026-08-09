import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  parseFidelityCsv,
  parseCSV,
  parseMoney,
  parseFidelityDate,
  parseFidelityTime,
  getActionSide,
} from "../lib/fidelity-parser.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(__dirname, "..", "sample-fidelity-trades.csv"), "utf8")

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
  assert(Math.abs(actual - expected) < eps, `${label} (got ${actual.toFixed(4)}, expected ${expected})`)
}

console.log("--- helpers ---")
assert(parseMoney("(1,234.56)") === -1234.56, "parseMoney parentheses negative")
assert(parseMoney("$1,234.56") === 1234.56, "parseMoney dollar + comma")
assert(parseMoney("-45.00") === -45, "parseMoney minus sign")
assert(parseMoney("") === 0, "parseMoney empty")
assert(parseFidelityDate("02/05/2026") === "2026-02-05", "parseFidelityDate")
assert(parseFidelityDate("01/15/2026 14:30") === "2026-01-15", "parseFidelityDate with time")
assert(parseFidelityTime("2:30 PM") === "14:30", "parseFidelityTime 12h PM")
assert(parseFidelityTime("14:30:00") === "14:30", "parseFidelityTime 24h")
assert(parseFidelityTime("") === "00:00", "parseFidelityTime empty")
assert(getActionSide("YOU BOUGHT") === "buy", "getActionSide buy")
assert(getActionSide("YOU SOLD TO OPEN") === "sell", "getActionSide sell")
assert(getActionSide("INTEREST PAID") === null, "getActionSide non-trade null")

const tokenized = parseCSV('"META PLATFORMS INC, CLASS A","2"\n"abc","""quoted"""')
assert(tokenized.length === 2, "parseCSV row count")
assert(tokenized[0][0] === "META PLATFORMS INC, CLASS A", "parseCSV embedded comma in quotes")
assert(tokenized[1][1] === '"quoted"', "parseCSV escaped double quotes")

console.log("--- full fixture ---")
const result = parseFidelityCsv(fixture)

assert(result.executions.length === 12, `executions count (got ${result.executions.length}, expected 12)`)
assert(result.skippedRows === 3, `skipped non-trade rows (got ${result.skippedRows}, expected 3)`)
assert(result.optionRows === 1, `skipped option rows (got ${result.optionRows}, expected 1)`)
assert(result.roundTrips.length === 5, `round trips (got ${result.roundTrips.length}, expected 5)`)
assert(result.openPositions.length === 1, `open positions (got ${result.openPositions.length}, expected 1)`)
assert(result.unmatchedSells.length === 1, `unmatched sells (got ${result.unmatchedSells.length}, expected 1)`)

const aapl = result.roundTrips.find((r) => r.symbol === "AAPL")
assert(!!aapl, "AAPL round trip exists")
if (aapl) {
  assert(aapl.shares === 100, "AAPL shares")
  assertClose(aapl.avgEntryPrice, 192.45, "AAPL avg entry")
  assertClose(aapl.avgExitPrice, 198.0, "AAPL avg exit")
  assertClose(aapl.pnl, 555.0, "AAPL pnl")
  assert(aapl.openDate === "2026-01-05", "AAPL open date")
  assert(aapl.closeDate === "2026-01-15", "AAPL close date")
}

const msft75 = result.roundTrips.find((r) => r.symbol === "MSFT" && r.shares === 75)
assert(!!msft75, "MSFT sell-75 round trip exists")
if (msft75) {
  assertClose(msft75.avgEntryPrice, 403.3333, "MSFT 75 avg entry")
  assertClose(msft75.pnl, 1625.0, "MSFT 75 pnl")
}

const msft25 = result.roundTrips.find((r) => r.symbol === "MSFT" && r.shares === 25)
assert(!!msft25, "MSFT sell-25 round trip exists")
if (msft25) {
  assertClose(msft25.avgEntryPrice, 410.0, "MSFT 25 avg entry")
  assertClose(msft25.pnl, 500.0, "MSFT 25 pnl")
}

const brk = result.roundTrips.find((r) => r.symbol === "BRK.B")
assert(!!brk, "BRK.B round trip exists")
if (brk) {
  assertClose(brk.pnl, 97.9, "BRK.B net pnl after fees")
  assertClose(brk.fee, 2.1, "BRK.B total fees")
}

const meta = result.roundTrips.find((r) => r.symbol === "META")
assert(!!meta, "META round trip exists (embedded comma description)")
if (meta) {
  assertClose(meta.pnl, 1000.0, "META pnl")
}

const nvda = result.openPositions.find((p) => p.symbol === "NVDA")
assert(!!nvda && nvda.shares === 10, "NVDA open position")

const tsla = result.unmatchedSells.find((u) => u.symbol === "TSLA")
assert(!!tsla && tsla.shares === 5, "TSLA unmatched sell")

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
