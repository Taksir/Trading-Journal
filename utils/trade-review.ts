import type { Trade } from "../types/trade.ts"
import type { TradeReviewStatus } from "../types/review.ts"
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
 * Criteria: the trade must be fully reviewed (all review signals answered) to
 * NOT need review. See `getReviewSignals` / `getReviewStatus` for the exact
 * signal set. This is a convenience helper only — no field is mandatory.
 */
export function needsReview(trade: Trade): boolean {
  if (!trade || !isTradeClosed(trade)) return false
  return getReviewStatus(trade) !== "complete"
}

/** Planned stop distance in % (manual or inferred), or null. */
export function getEffectiveStopPct(trade: Trade): number | null {
  if (isFiniteNumber(trade.plannedStopPct) && trade.plannedStopPct > 0) return trade.plannedStopPct
  return null
}

/**
 * The individual review signals.
 *
 * - `hasStopInfo`  : any stop information exists — a manual stop OR an inferred
 *   stop (convenience value from the realized loss). An inferred value means
 *   the loss is at least measurable.
 * - `hasPlannedStopRecorded` : a stop was CONSCIOUSLY planned (`stopSource`
 *   "manual" or a manual stopLoss). An inferred stop is NOT evidence a stop was
 *   planned — this distinction matters for stop-adherence analytics, where only
 *   manually planned stops count.
 * - `tradeThesis` is intentionally NOT a completion signal: imported historical
 *   trades often predate thesis recording and are still fully reviewable.
 */
export interface ReviewSignals {
  hasSetup: boolean
  hasGrade: boolean
  hasStopInfo: boolean
  hasPlannedStopRecorded: boolean
  processAnswered: boolean
  hasReviewNotes: boolean
}

export function getReviewSignals(trade: Trade): ReviewSignals {
  const hasSetup = Boolean(trade && trade.setupId && trade.setupId.length > 0)
  const hasGrade = Boolean(trade && trade.manualSetupGrade)
  const hasStopInfo = Boolean(trade && (getManualStopPct(trade) !== null || getEffectiveStopPct(trade) !== null))
  const hasPlannedStopRecorded = Boolean(trade && (trade.stopSource === "manual" || getManualStopPct(trade) !== null))
  const processAnswered = Boolean(
    trade && (trade.manualProcessFollowed === true || trade.manualProcessFollowed === false),
  )
  const hasReviewNotes = Boolean(trade && trade.reviewNotes && trade.reviewNotes.trim().length > 0)
  return { hasSetup, hasGrade, hasStopInfo, hasPlannedStopRecorded, processAnswered, hasReviewNotes }
}

/**
 * Review status of a CLOSED trade:
 * - "complete"     : all 5 signals answered (setup, grade, stop info, process, notes).
 * - "needs-review" : none answered — nothing has been recorded yet.
 * - "partial"      : some answered, some missing.
 * Open trades report "needs-review" for bookkeeping but are excluded from the
 * review queue (see `needsReview`).
 */
export function getReviewStatus(trade: Trade): TradeReviewStatus {
  if (!trade || !isTradeClosed(trade)) return "needs-review"
  const signals = getReviewSignals(trade)
  const answered = [
    signals.hasSetup,
    signals.hasGrade,
    signals.hasStopInfo,
    signals.processAnswered,
    signals.hasReviewNotes,
  ].filter(Boolean).length
  if (answered === 5) return "complete"
  if (answered === 0) return "needs-review"
  return "partial"
}

/** Whether a closed trade is fully reviewed (all review signals present). */
export function isTradeReviewed(trade: Trade): boolean {
  return getReviewStatus(trade) === "complete"
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

/**
 * Stop adherence deviation in PERCENTAGE POINTS:
 * `abs(realizedLossPct) - abs(manualPlannedStopPct)`.
 * Positive = realized loss was bigger than planned (worse); negative = the
 * trade was stopped out tighter than planned (better). Only MANUALLY planned
 * stops participate — inferred stops are circular (the realized loss defines
 * them) and are excluded. Units are explicit: p.p. of price, not a % ratio.
 */
export function getStopDeviationPct(trade: Trade): number | null {
  if (!trade || !isTradeClosed(trade)) return null
  const planned = getManualStopPct(trade)
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
  if (!trade || !isTradeClosed(trade)) return "Open"
  switch (getReviewStatus(trade)) {
    case "complete":
      return "Reviewed"
    case "partial":
      return "Partial"
    default:
      return "Needs Review"
  }
}
