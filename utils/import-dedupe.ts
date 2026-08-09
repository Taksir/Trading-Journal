import type { Trade } from "../types/trade"
import { getCloseTimestamp } from "./quant-metrics.ts"

/**
 * Duplicate import protection.
 *
 * Duplicate identity is SCOPED PER ACCOUNT: an otherwise identical trade
 * imported into Account A is NOT a duplicate of the same trade in Account B,
 * because `accountId` participates in the signature.
 *
 * Signature sources:
 * - Broker order/trade ids (`ticket`) when present and reliable (Exness).
 * - Otherwise a deterministic signature built from accountId + source +
 *   symbol + entry/exit timestamps + quantity + entry/exit price (Fidelity).
 *
 * We never rely on symbol/date alone. Conflicts (same signature but diverging
 * payloads) are reported and skipped rather than silently merged.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeNumber(value: number | undefined | null): string {
  if (!isFiniteNumber(value)) return ""
  return value.toFixed(6).replace(/\.?0+$/, "")
}

function safeTicket(ticket: string | undefined | null): string {
  return String(ticket || "").trim()
}

/**
 * Deterministic duplicate signature for a trade. The account id always
 * participates so identical trades across accounts are never conflated.
 */
export function buildTradeSignature(trade: Trade | Omit<Trade, "id">): string {
  const accountId = String(trade.accountId || "").trim()

  const ticket = safeTicket(trade.ticket)
  if (ticket) {
    return `t:${accountId}|${ticket}`
  }

  const openTs = getCloseTimestamp({ ...(trade as Trade), endDate: trade.date, endTime: trade.time })
  const closeTs = trade.endDate
    ? getCloseTimestamp(trade as Trade)
    : null

  const openKey = openTs !== null ? String(openTs) : `${trade.date || ""}|${trade.time || ""}`
  const closeKey = closeTs !== null ? String(closeTs) : trade.endDate || "open"

  return [
    "s",
    accountId,
    trade.system || "unknown",
    trade.asset || "",
    openKey,
    closeKey,
    normalizeNumber(trade.positionSize),
    normalizeNumber(trade.entryPrice),
    normalizeNumber(trade.exitPrice),
  ].join("|")
}

export interface DedupeResult {
  newTrades: Omit<Trade, "id">[]
  duplicates: Omit<Trade, "id">[]
  /** Same signature but different payload — skipped to avoid corrupting history. */
  conflicts: Omit<Trade, "id">[]
}

function payloadEqual(a: Trade | Omit<Trade, "id">, b: Trade | Omit<Trade, "id">): boolean {
  const numericFields = ["entryPrice", "exitPrice", "positionSize", "pnl"] as const
  for (const field of numericFields) {
    if (Number(a[field]) !== Number(b[field])) return false
  }
  if (a.asset !== b.asset) return false
  if (a.endDate !== b.endDate) return false
  return true
}

/**
 * Detect duplicates between existing stored trades and an incoming batch.
 * The signature set is built once per call so it can be used cheaply.
 */
export function detectDuplicates(existing: Trade[], incoming: Omit<Trade, "id">[]): DedupeResult {
  const signatureToTrade = new Map<string, Trade>()
  for (const trade of existing) {
    const signature = buildTradeSignature(trade)
    if (!signatureToTrade.has(signature)) signatureToTrade.set(signature, trade)
  }

  const newTrades: Omit<Trade, "id">[] = []
  const duplicates: Omit<Trade, "id">[] = []
  const conflicts: Omit<Trade, "id">[] = []

  for (const trade of incoming) {
    const signature = buildTradeSignature(trade)
    const match = signatureToTrade.get(signature)
    if (match) {
      if (payloadEqual(match, trade)) {
        duplicates.push(trade)
      } else {
        conflicts.push(trade)
      }
    } else {
      signatureToTrade.set(signature, trade as Trade)
      newTrades.push(trade)
    }
  }

  return { newTrades, duplicates, conflicts }
}

/** Keep legacy import code that relied on plain ticket presence working. */
export function hasUsableTicket(trade: Trade | Omit<Trade, "id">): boolean {
  return Boolean(safeTicket(trade.ticket))
}

export function isValidDateKey(value: string | undefined | null): boolean {
  return Boolean(value && DATE_KEY_PATTERN.test(value))
}
