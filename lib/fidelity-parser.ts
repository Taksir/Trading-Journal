/**
 * Fidelity "Accounts History" CSV parser.
 *
 * Fidelity exports one row per order/execution (not per closed trade), so buys
 * and sells are paired per symbol (FIFO) into round-trip trades.
 *
 * This module is intentionally dependency-free so it can be unit tested with
 * plain Node (type stripping) as well as used inside the Next.js app.
 */

export interface FidelityExecution {
  symbol: string
  side: "buy" | "sell"
  quantity: number
  price: number
  commission: number
  fees: number
  date: string // YYYY-MM-DD
  time: string // HH:MM
  action: string
}

interface FidelityLot {
  symbol: string
  quantity: number
  price: number
  fee: number
  date: string
  time: string
}

export interface FidelityRoundTrip {
  symbol: string
  openDate: string
  openTime: string
  closeDate: string
  closeTime: string
  shares: number
  avgEntryPrice: number
  avgExitPrice: number
  pnl: number
  fee: number
  ticket: string
}

export interface FidelityOpenPosition {
  symbol: string
  shares: number
  avgPrice: number
  date: string
}

export interface FidelityUnmatchedSell {
  symbol: string
  shares: number
  date: string
}

export interface FidelityParseResult {
  roundTrips: FidelityRoundTrip[]
  openPositions: FidelityOpenPosition[]
  unmatchedSells: FidelityUnmatchedSell[]
  executions: FidelityExecution[]
  skippedRows: number
  optionRows: number
}

/**
 * Minimal RFC-4180 style CSV tokenizer. Handles quoted fields, embedded commas
 * and escaped double quotes. Fidelity wraps every field in quotes and several
 * fields (e.g. Security Description) contain commas.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (c !== "\r") {
      field += c
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "")

export function parseMoney(value: string): number {
  if (value === undefined || value === null || value === "") return 0
  const clean = String(value).replace(/[$,\s]/g, "")
  if (clean === "" || clean === "(" || clean === ")") return 0
  const isNegative = clean.startsWith("(") && clean.endsWith(")")
  const num = parseFloat(clean.replace(/[()]/g, ""))
  return isNaN(num) ? 0 : isNegative ? -num : num
}

export function parseFidelityDate(value: string): string {
  const clean = (value || "").trim().split(" ")[0]
  const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ""
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`
}

export function parseFidelityTime(value: string): string {
  const clean = (value || "").trim()
  const match = clean.match(/(\d{1,2}):(\d{2})/)
  if (!match) return "00:00"
  let hours = parseInt(match[1], 10)
  const minutes = match[2]
  const upper = clean.toUpperCase()
  if (upper.includes("PM") && hours < 12) hours += 12
  if (upper.includes("AM") && hours === 12) hours = 0
  return `${String(hours).padStart(2, "0")}:${minutes}`
}

export function getActionSide(action: string): "buy" | "sell" | null {
  const a = (action || "").toUpperCase()
  if (a.includes("YOU BOUGHT") || a.includes("BOUGHT TO OPEN")) return "buy"
  if (a.includes("YOU SOLD") || a.includes("SOLD TO OPEN")) return "sell"
  return null
}

const NON_TRADE_MARKERS = [
  "ELECTRONIC",
  "TRANSFER",
  "INTEREST",
  "DIVIDEND",
  "WITHDRAWAL",
  "WITHDREW",
  "DEPOSIT",
  "CREDIT",
  "DEBIT",
  "REBATE",
  "ADJUSTMENT",
  "JOURNAL",
  "CONVERSION",
  "MONEY MARKET",
  "PURCHASE FEE",
  "ACCOUNT FEE",
  "RETURN OF CAPITAL",
  "SPIN-OFF",
  "MERGER",
  "STOCK SPLIT",
]

export function isNonTradeAction(action: string): boolean {
  const a = (action || "").toUpperCase()
  return NON_TRADE_MARKERS.some((marker) => a.includes(marker))
}

const OPTION_SYMBOL_PATTERN = /^[+-]?[A-Z.]{1,6}\d{6}[CP]\d{1,8}$/

export function isOptionRow(action: string, symbol: string, securityType?: string): boolean {
  const a = (action || "").toUpperCase()
  const cleanSymbol = (symbol || "").replace(/^[+-]/, "")
  if (OPTION_SYMBOL_PATTERN.test(cleanSymbol)) return true
  if (a.includes("OPTION")) return true
  if (a.includes("PUT") || a.includes("CALL")) return true
  if ((securityType || "").toUpperCase() === "OPTION") return true
  return false
}

/**
 * Parse raw Fidelity CSV text into a list of buy/sell executions.
 * Rows that are not trades (dividends, transfers, interest, ...) or that are
 * option rows are skipped and counted.
 */
export function parseFidelityExecutions(
  csvText: string
): { executions: FidelityExecution[]; skippedRows: number; optionRows: number } {
  const rows = parseCSV(String(csvText || "").replace(/^\uFEFF/, ""))

  let headerIndex = -1
  for (let i = 0; i < rows.length; i++) {
    const normalized = rows[i].map(normalizeHeader)
    if (
      normalized.includes("action") &&
      normalized.includes("symbol") &&
      normalized.includes("rundate")
    ) {
      headerIndex = i
      break
    }
  }

  if (headerIndex === -1) {
    throw new Error(
      "Could not find the Fidelity header row (Run Date, Action, Symbol). Is this a Fidelity Accounts History CSV?"
    )
  }

  const headers = rows[headerIndex].map(normalizeHeader)
  const col = (name: string): number => headers.indexOf(name)

  const cols = {
    runDate: col("rundate"),
    action: col("action"),
    symbol: col("symbol"),
    quantity: col("quantity"),
    price: col("price"),
    commission: col("commission"),
    fees: col("fees"),
    orderTime: col("ordertime"),
    securityType: col("securitytype"),
  }

  const executions: FidelityExecution[] = []
  let skippedRows = 0
  let optionRows = 0

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const runDate = parseFidelityDate(getRowValue(row, cols.runDate))
    if (!runDate) continue

    const action = getRowValue(row, cols.action)
    if (!action) continue

    const symbol = getRowValue(row, cols.symbol).replace(/^[+-]/, "").toUpperCase()
    if (!symbol) continue

    if (isOptionRow(action, getRowValue(row, cols.symbol), getRowValue(row, cols.securityType))) {
      optionRows++
      continue
    }

    if (action.toUpperCase().includes("REINVEST")) {
      // Dividend reinvestments genuinely add shares; treat as a buy.
      executions.push(
        buildExecution(action, symbol, "buy", runDate, row, cols)
      )
      continue
    }

    if (isNonTradeAction(action)) {
      skippedRows++
      continue
    }

    const side = getActionSide(action)
    if (!side) {
      skippedRows++
      continue
    }

    executions.push(buildExecution(action, symbol, side, runDate, row, cols))
  }

  return { executions, skippedRows, optionRows }
}

function getRowValue(row: string[], col: number): string {
  return col >= 0 && col < row.length ? (row[col] ?? "").trim() : ""
}

function buildExecution(
  action: string,
  symbol: string,
  side: "buy" | "sell",
  runDate: string,
  row: string[],
  cols: Record<string, number>
): FidelityExecution {
  const quantity = Math.abs(parseMoney(getRowValue(row, cols.quantity)))
  const price = parseMoney(getRowValue(row, cols.price))
  const commission = parseMoney(getRowValue(row, cols.commission))
  const fees = parseMoney(getRowValue(row, cols.fees))
  const time = parseFidelityTime(getRowValue(row, cols.orderTime))

  return {
    symbol,
    side,
    quantity,
    price,
    commission,
    fees,
    date: runDate,
    time,
    action,
  }
}

/**
 * Pair buy/sell executions per symbol (FIFO) into closed round-trip trades.
 * Unmatched buys become open positions; unmatched sells are reported for manual
 * review (e.g. short sales or a missing buy row).
 */
export function pairFidelityRoundTrips(executions: FidelityExecution[]): FidelityParseResult {
  const bySymbol = new Map<string, FidelityExecution[]>()

  for (const execution of executions) {
    const list = bySymbol.get(execution.symbol)
    if (list) list.push(execution)
    else bySymbol.set(execution.symbol, [execution])
  }

  const roundTrips: FidelityRoundTrip[] = []
  const openPositions: FidelityOpenPosition[] = []
  const unmatchedSells: FidelityUnmatchedSell[] = []

  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    const lots: FidelityLot[] = []

    for (const execution of list) {
      if (execution.side === "buy") {
        lots.push({
          symbol,
          quantity: execution.quantity,
          price: execution.price,
          fee: execution.commission + execution.fees,
          date: execution.date,
          time: execution.time,
        })
        continue
      }

      let remaining = execution.quantity
      let matchedShares = 0
      let weightedEntry = 0
      let buyFees = 0
      let firstDate = ""
      let firstTime = ""

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]
        const matched = Math.min(remaining, lot.quantity)
        if (matchedShares === 0) {
          firstDate = lot.date
          firstTime = lot.time
        }
        matchedShares += matched
        weightedEntry += lot.price * matched
        const lotFeeShare = lot.quantity > 0 ? lot.fee * (matched / lot.quantity) : 0
        buyFees += lotFeeShare
        lot.fee -= lotFeeShare
        lot.quantity -= matched
        if (lot.quantity <= 0) lots.shift()
        remaining -= matched
      }

      if (remaining > 0) {
        unmatchedSells.push({ symbol, shares: remaining, date: execution.date })
        continue
      }

      const sellFee = execution.commission + execution.fees
      const avgEntryPrice = matchedShares > 0 ? weightedEntry / matchedShares : 0
      const grossPnl = (execution.price - avgEntryPrice) * matchedShares
      const fee = buyFees + sellFee
      const pnl = grossPnl - fee

      roundTrips.push({
        symbol,
        openDate: firstDate || execution.date,
        openTime: firstTime || "00:00",
        closeDate: execution.date,
        closeTime: execution.time,
        shares: matchedShares,
        avgEntryPrice,
        avgExitPrice: execution.price,
        pnl,
        fee,
        ticket: buildFidelityTicket(symbol, firstDate, execution.date, matchedShares),
      })
    }

    for (const lot of lots) {
      openPositions.push({ symbol, shares: lot.quantity, avgPrice: lot.price, date: lot.date })
    }
  }

  roundTrips.sort((a, b) => (a.closeDate + a.closeTime).localeCompare(b.closeDate + b.closeTime))

  return {
    roundTrips,
    openPositions,
    unmatchedSells,
    executions,
    skippedRows: 0,
    optionRows: 0,
  }
}

export function parseFidelityCsv(csvText: string): FidelityParseResult {
  const { executions, skippedRows, optionRows } = parseFidelityExecutions(csvText)
  const result = pairFidelityRoundTrips(executions)
  result.skippedRows = skippedRows
  result.optionRows = optionRows
  return result
}

export function buildFidelityTicket(
  symbol: string,
  openDate: string,
  closeDate: string,
  shares: number
): string {
  return `${symbol}|${openDate}|${closeDate}|${shares}`
}
