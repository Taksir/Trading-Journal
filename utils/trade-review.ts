import type { Trade } from "../types/trade"
import { isTradeClosed } from "./quant-metrics.ts"

/**
 * Trade review helpers.
 *
 * Design notes:
 * - Human-entered fields (`manualSetupGrade`, `tradeThesis`, `reviewNotes`,
 *   planned stop) are kept distinct from any future automated fields so AI
 *   reports can never overwrite the human's original observations.
 * - The planned stop is "manual" when a stop price is known on the trade;
 *   otherwise a convenience stop is INFERRED for closed losing trades from the
 *   realized loss percentage and marked `inferred`. An inferred value never
 *   masquerades as a manually planned stop (`stopSource` distinguishes them)
 *   and a later manual override simply replaces it.
 */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safePnl(trade: Trade): number {
  const value = Number(trade.pnl)
  return isFiniteNumber(value) ? value : 0
}

/** Net return % of a trade relative to its position notional. */
export function getTradeReturnPct(trade: Trade): number | null {
  const entry = Number(trade.entryPrice)
  const size = Number(trade.positionSize)
  if (!isFiniteNumber(entry) || !isFiniteNumber(size)) return null
  const notional = Math.abs(entry * size)
  if (notional <= 0) return null
  return (safePnl(trade) / notional) * 100
}

/** Realized loss % for a losing trade (positive number), else null. */
export function getRealizedLossPct(trade: Trade): number | null {
  const returnPct = getTradeReturnPct(trade)
  if (returnPct === null || returnPct >= 0) return null
  return Math.abs(returnPct)
}

/**
 * Manual stop distance in percent of entry from `stopLoss` (which mirrors
 * `plannedStopPrice`). Returns null when no manual stop is present.
 */
export function getManualStopPct(trade: Trade): number | null {
  const entry = Number(trade.entryPrice)
  const stop = Number(trade.stopLoss)
  if (!isFiniteNumber(entry) || entry <= 0 || !isFiniteNumber(stop) || stop <= 0) return null
  return (Math.abs(entry - stop) / entry) * 100
}

/**
 * Apply stop metadata to a trade:
 * - manual stop present  -> plannedStopPct from stopLoss, stopSource "manual"
 * - closed losing, no manual stop -> plannedStopPct = realized loss pct,
 *   stopSource "inferred", inferredStopPct recorded
 * - otherwise -> stopSource "none"
 *
 * Returns a shallow-copied trade with the stop fields set. Never mutates input.
 * Accepts both full trades and draft trades (id not yet assigned).
 */
export function applyStopInfo<T extends Trade | Omit<Trade, "id">>(trade: T): T {
  const manualPct = getManualStopPct(trade as Trade)
  if (manualPct !== null) {
    return {
      ...trade,
      plannedStopPrice: isFiniteNumber(trade.stopLoss) ? trade.stopLoss : trade.plannedStopPrice,
      plannedStopPct: manualPct,
      stopSource: "manual",
    }
  }

  if (isTradeClosed(trade as Trade) && safePnl(trade as Trade) < 0) {
    const realizedLossPct = getRealizedLossPct(trade as Trade)
    if (realizedLossPct !== null) {
      return {
        ...trade,
        plannedStopPct: realizedLossPct,
        stopSource: "inferred",
        inferredStopPct: realizedLossPct,
      }
    }
  }

  return { ...trade, plannedStopPct: trade.plannedStopPct, stopSource: "none" }
}

/**
 * Whether a CLOSED trade is missing review information (groundwork for a
 * future "N trades need review" queue). Open trades are excluded.
 *
 * Criteria: no setup, no human setup grade, no planned/inferred stop, and no
 * review notes. None of these fields are mandatory — this is a convenience
 * helper only.
 */
export function needsReview(trade: Trade): boolean {
  if (!trade || !isTradeClosed(trade)) return false
  if (!trade.setupId) return true
  if (!trade.manualSetupGrade) return true
  // A manual stop (stopLoss) or a planned/inferred pct both satisfy the stop.
  if (getManualStopPct(trade) === null && getEffectiveStopPct(trade) === null) return true
  if (!trade.reviewNotes) return true
  return false
}

/** Planned stop distance in % (manual or inferred), or null. */
export function getEffectiveStopPct(trade: Trade): number | null {
  if (isFiniteNumber(trade.plannedStopPct) && trade.plannedStopPct > 0) return trade.plannedStopPct
  return null
}

/**
 * "Do I systematically lose more than my planned stop?" building block:
 * returns the slippage/excess above the planned stop for a losing trade.
 * Positive means realized loss exceeds the planned stop distance.
 */
export function getStopSlippagePct(trade: Trade): number | null {
  const planned = getEffectiveStopPct(trade)
  const realized = getRealizedLossPct(trade)
  if (planned === null || realized === null) return null
  return realized - planned
}

/** Alias kept for readability; a closed breakeven is NOT a losing stop. */
export function isClosedLoss(trade: Trade): boolean {
  return isTradeClosed(trade) && safePnl(trade) < 0
}

export function isBreakeven(trade: Trade): boolean {
  return isTradeClosed(trade) && safePnl(trade) === 0
}

export function getReviewStatusLabel(trade: Trade): string {
  if (!isTradeClosed(trade)) return "Open"
  if (!needsReview(trade)) return "Reviewed"
  return "Needs Review"
}
