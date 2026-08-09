import type { Trade } from "../types/trade.ts"
import type { ManualSetupGrade } from "../types/trade.ts"
import type { Setup } from "../types/setup.ts"
import { MISTAKES, type MistakeDefinition, type ReviewPatch } from "../types/review.ts"
import {
  calculateNetR,
  calculateTradeReturnPct,
  getCloseDateKey,
  getCloseTimestamp,
  isTradeClosed,
  mean,
} from "./quant-metrics.ts"
import {
  getManualStopPct,
  getRealizedLossPct,
  getReviewSignals,
  getReviewStatus,
} from "./trade-review.ts"
import { getSetupName } from "./setups.ts"

/**
 * Pure review analytics.
 *
 * Conventions (documented, deterministic, matching the verified quant layer):
 * - Only CLOSED trades participate. Open trades are NEVER treated as
 *   zero-result trades — they simply do not appear in realized-outcome metrics.
 * - A breakeven is a closed trade: it counts in trade counts and the win-rate
 *   denominator, contributes 0R, and is NOT a losing trade for stop adherence.
 * - Win/loss is classified by net pnl (pnl > 0 win, pnl < 0 loss, pnl === 0
 *   breakeven), exactly like `calculateQuantMetrics`.
 * - All functions are pure; they never mutate the input arrays.
 * - Callers pass ALREADY scope-filtered trades. Grouped analytics filter by
 *   scope first (in the caller), then these functions operate on the subset.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function safePnl(trade: Trade): number {
  const value = Number(trade.pnl)
  return isFiniteNumber(value) ? value : 0
}

// ------------------------------------------------------------- sample size

/** Centralized sample-size thresholds (n of closed trades in the group). */
export const SAMPLE_SIZE = {
  verySmall: 5,
  limited: 20,
} as const

export type SampleSizeBand = "very-small" | "limited" | null

/** n < 5 -> "very-small", n < 20 -> "limited", n >= 20 -> null (no warning). */
export function getSampleSizeBand(n: number): SampleSizeBand {
  if (!isFiniteNumber(n)) return null
  if (n < SAMPLE_SIZE.verySmall) return "very-small"
  if (n < SAMPLE_SIZE.limited) return "limited"
  return null
}

export const SAMPLE_SIZE_LABELS: Record<NonNullable<SampleSizeBand>, string> = {
  "very-small": "Very small sample",
  limited: "Limited sample",
}

// -------------------------------------------------------------- group stats

export interface GroupStats {
  tradeCount: number
  winRate: number | null
  avgWinPct: number | null
  avgLossPct: number | null
  avgWinningR: number | null
  avgLosingR: number | null
  expectancyR: number | null
  profitFactor: number | null
  totalNetPnl: number
  avgNetR: number | null
  maxConsecutiveLosses: number
}

/**
 * Shared outcome stats for a group of CLOSED trades. Expectancy R == avg net R
 * (mean of net R across the group). Win rate denominator includes breakevens.
 */
export function computeGroupStats(closedTrades: Trade[]): GroupStats {
  const n = closedTrades.length
  let wins = 0
  let losses = 0
  let grossProfit = 0
  let grossLoss = 0
  let totalPnl = 0
  const winReturns: number[] = []
  const lossReturns: number[] = []
  const winR: number[] = []
  const lossR: number[] = []
  const allR: number[] = []

  for (const trade of closedTrades) {
    const pnl = safePnl(trade)
    totalPnl += pnl
    const netR = calculateNetR(trade)
    allR.push(netR)
    const returnPct = calculateTradeReturnPct(trade)
    if (pnl > 0) {
      wins += 1
      grossProfit += pnl
      if (returnPct !== null) winReturns.push(returnPct)
      winR.push(netR)
    } else if (pnl < 0) {
      losses += 1
      grossLoss += -pnl
      if (returnPct !== null) lossReturns.push(returnPct)
      lossR.push(netR)
    }
  }

  const expectancy = mean(allR)
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null

  return {
    tradeCount: n,
    winRate: n > 0 ? (wins / n) * 100 : null,
    avgWinPct: mean(winReturns),
    avgLossPct: mean(lossReturns),
    avgWinningR: mean(winR),
    avgLosingR: mean(lossR),
    expectancyR: expectancy,
    profitFactor,
    totalNetPnl: totalPnl,
    avgNetR: expectancy,
    maxConsecutiveLosses: computeMaxLossStreak(closedTrades),
  }
}

/** Largest streak of consecutive losing trades (breakeven resets), by close time. */
function computeMaxLossStreak(closedTrades: Trade[]): number {
  const sorted = closedTrades
    .map((trade) => ({ trade, timestamp: getCloseTimestamp(trade) }))
    .filter((entry): entry is { trade: Trade; timestamp: number } => entry.timestamp !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  let current = 0
  let max = 0
  for (const { trade } of sorted) {
    if (safePnl(trade) < 0) {
      current += 1
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  return max
}

// --------------------------------------------------------- setup analytics

export interface SetupPerformance extends GroupStats {
  /** null = trades with no setup assigned (shown separately). */
  setupId: string | null
  name: string
}

/**
 * Per-setup closed-trade performance. Unassigned trades are a separate group.
 * Default sort: expectancy R descending (null expectancy last), then count.
 */
export function calculateSetupPerformance(trades: Trade[], setups: Setup[]): SetupPerformance[] {
  const closed = trades.filter(isTradeClosed)

  const groups = new Map<string, Trade[]>()
  for (const trade of closed) {
    const key = trade.setupId && trade.setupId.length > 0 ? trade.setupId : ""
    const list = groups.get(key) || []
    list.push(trade)
    groups.set(key, list)
  }

  const rows: SetupPerformance[] = []
  for (const [setupId, groupTrades] of groups) {
    const resolvedId = setupId || null
    rows.push({
      setupId: resolvedId,
      name: resolvedId ? getSetupName(setups, resolvedId) || "Unknown" : "Unassigned",
      ...computeGroupStats(groupTrades),
    })
  }

  rows.sort(
    (a, b) =>
      (b.expectancyR ?? Number.NEGATIVE_INFINITY) - (a.expectancyR ?? Number.NEGATIVE_INFINITY) ||
      b.tradeCount - a.tradeCount,
  )
  return rows
}

// --------------------------------------------------------- grade analytics

export interface GradePerformance extends GroupStats {
  grade: ManualSetupGrade
}

export interface UngradedPerformance extends GroupStats {
  grade: null
}

export interface GradePerformanceResult {
  buckets: GradePerformance[]
  ungraded: UngradedPerformance | null
}

const GRADE_ORDER: ManualSetupGrade[] = ["A+", "A", "B", "C", "D", "F"]

/**
 * Per manual-grade performance. Only CLOSED trades with a manual setup grade
 * populate the buckets; closed trades without a manual grade are reported
 * separately (Ungraded) — they are never folded into a grade bucket.
 */
export function calculateGradePerformance(trades: Trade[]): GradePerformanceResult {
  const closed = trades.filter(isTradeClosed)

  const byGrade = new Map<ManualSetupGrade, Trade[]>()
  const ungraded: Trade[] = []
  for (const trade of closed) {
    const grade = trade.manualSetupGrade
    if (grade && GRADE_ORDER.includes(grade)) {
      const list = byGrade.get(grade) || []
      list.push(trade)
      byGrade.set(grade, list)
    } else {
      ungraded.push(trade)
    }
  }

  const buckets: GradePerformance[] = []
  for (const grade of GRADE_ORDER) {
    const groupTrades = byGrade.get(grade)
    if (!groupTrades) continue
    buckets.push({ grade, ...computeGroupStats(groupTrades) })
  }

  const ungradedResult: UngradedPerformance | null =
    ungraded.length > 0 ? { grade: null, ...computeGroupStats(ungraded) } : null

  return { buckets, ungraded: ungradedResult }
}

// ------------------------------------------------------ process / mistakes

export interface ProcessGroupStats extends GroupStats {
  /** Share of all CLOSED trades in this group (followed or violated). */
  reviewSharePct: number | null
}

export interface ProcessPerformance {
  followed: ProcessGroupStats
  violated: ProcessGroupStats
  reviewedCount: number
  /** Closed trades whose process was NOT answered — excluded from both groups. */
  unreviewedCount: number
}

export function calculateProcessPerformance(trades: Trade[]): ProcessPerformance {
  const closed = trades.filter(isTradeClosed)
  const followed: Trade[] = []
  const violated: Trade[] = []
  let unreviewed = 0

  for (const trade of closed) {
    if (trade.manualProcessFollowed === true) followed.push(trade)
    else if (trade.manualProcessFollowed === false) violated.push(trade)
    else unreviewed += 1
  }

  const total = closed.length
  const withShare = (stats: GroupStats, count: number): ProcessGroupStats => ({
    ...stats,
    reviewSharePct: total > 0 ? (count / total) * 100 : null,
  })

  return {
    followed: withShare(computeGroupStats(followed), followed.length),
    violated: withShare(computeGroupStats(violated), violated.length),
    reviewedCount: followed.length + violated.length,
    unreviewedCount: unreviewed,
  }
}

export interface MistakePerformance {
  mistakeId: string
  label: string
  /** Closed trades tagged with this mistake. Each trade counted once per category. */
  affectedTradeCount: number
  avgR: number | null
  /** Net P&L of the affected trades. This is NOT a "cost of the mistake" claim. */
  netPnl: number
  winCount: number
  lossCount: number
}

/**
 * Per-mistake-category performance across CLOSED trades. A trade with multiple
 * mistakes contributes to every category it is tagged with (once each).
 * Categories with zero affected trades are omitted.
 */
export function calculateMistakePerformance(
  trades: Trade[],
  catalog: MistakeDefinition[] = MISTAKES,
): MistakePerformance[] {
  const closed = trades.filter(isTradeClosed)
  const rows: MistakePerformance[] = []

  for (const definition of catalog) {
    const affected = closed.filter(
      (trade) => Array.isArray(trade.manualMistakeIds) && trade.manualMistakeIds.includes(definition.id),
    )
    if (affected.length === 0) continue

    let netPnl = 0
    let wins = 0
    let losses = 0
    const rs: number[] = []
    for (const trade of affected) {
      const pnl = safePnl(trade)
      netPnl += pnl
      rs.push(calculateNetR(trade))
      if (pnl > 0) wins += 1
      else if (pnl < 0) losses += 1
    }

    rows.push({
      mistakeId: definition.id,
      label: definition.label,
      affectedTradeCount: affected.length,
      avgR: mean(rs),
      netPnl,
      winCount: wins,
      lossCount: losses,
    })
  }

  rows.sort((a, b) => b.affectedTradeCount - a.affectedTradeCount || b.netPnl - a.netPnl)
  return rows
}

// --------------------------------------------------------- stop adherence

/** Centralized tolerance in percentage points (0.05 p.p.). */
export const STOP_ADHERENCE_TOLERANCE_PP = 0.05

export interface StopAdherenceMetrics {
  /** Closed losing trades with a MANUALLY planned stop. */
  losingWithManualStop: number
  /** Closed losing trades in total (denominator for coverage). */
  totalLosing: number
  /** Manual stop coverage = losingWithManualStop / totalLosing * 100. */
  coveragePct: number | null
  avgPlannedStopPct: number | null
  avgRealizedLossPct: number | null
  /** Average deviation in percentage points (positive = lost more than planned). */
  avgDeviationPct: number | null
  /** |deviation| <= tolerance. */
  containedCount: number
  /** deviation > +tolerance (lost MORE than planned). */
  exceedingCount: number
  /** deviation < -tolerance (lost LESS than planned — favorable). */
  favorableCount: number
  containedPct: number | null
  exceedingPct: number | null
}

/**
 * Stop adherence for CLOSED LOSING trades. Only MANUALLY planned stops count —
 * inferred stops are excluded (circular analysis, see trade-review.ts).
 * Deviation is in PERCENTAGE POINTS: abs(realizedLossPct) - abs(plannedPct).
 */
export function calculateStopAdherence(trades: Trade[]): StopAdherenceMetrics {
  const closed = trades.filter(isTradeClosed)
  const losing = closed.filter((trade) => safePnl(trade) < 0)
  const totalLosing = losing.length

  const deviations: number[] = []
  const planned: number[] = []
  const realized: number[] = []
  for (const trade of losing) {
    const plannedPct = getManualStopPct(trade)
    const realizedPct = getRealizedLossPct(trade)
    if (plannedPct === null || realizedPct === null) continue
    deviations.push(realizedPct - plannedPct)
    planned.push(plannedPct)
    realized.push(realizedPct)
  }

  const sample = deviations.length
  const contained = deviations.filter((d) => Math.abs(d) <= STOP_ADHERENCE_TOLERANCE_PP).length
  const exceeding = deviations.filter((d) => d > STOP_ADHERENCE_TOLERANCE_PP).length
  const favorable = deviations.filter((d) => d < -STOP_ADHERENCE_TOLERANCE_PP).length

  return {
    losingWithManualStop: sample,
    totalLosing,
    coveragePct: totalLosing > 0 ? (sample / totalLosing) * 100 : null,
    avgPlannedStopPct: mean(planned),
    avgRealizedLossPct: mean(realized),
    avgDeviationPct: mean(deviations),
    containedCount: contained,
    exceedingCount: exceeding,
    favorableCount: favorable,
    containedPct: sample > 0 ? (contained / sample) * 100 : null,
    exceedingPct: sample > 0 ? (exceeding / sample) * 100 : null,
  }
}

// --------------------------------------------------------- review summary

export interface ReviewSummary {
  totalClosed: number
  complete: number
  partial: number
  needsReview: number
  missingSetup: number
  missingGrade: number
  missingStop: number
  missingProcess: number
  missingNotes: number
}

/** Queue + completeness summary over CLOSED trades (scope-filtered by caller). */
export function summarizeReview(trades: Trade[]): ReviewSummary {
  const closed = trades.filter(isTradeClosed)
  let complete = 0
  let partial = 0
  let needsReview = 0
  let missingSetup = 0
  let missingGrade = 0
  let missingStop = 0
  let missingProcess = 0
  let missingNotes = 0

  for (const trade of closed) {
    const status = getReviewStatus(trade)
    if (status === "complete") complete += 1
    else if (status === "partial") partial += 1
    else needsReview += 1

    const signals = getReviewSignals(trade)
    if (!signals.hasSetup) missingSetup += 1
    if (!signals.hasGrade) missingGrade += 1
    if (!signals.hasStopInfo) missingStop += 1
    if (!signals.processAnswered) missingProcess += 1
    if (!signals.hasReviewNotes) missingNotes += 1
  }

  return {
    totalClosed: closed.length,
    complete,
    partial,
    needsReview,
    missingSetup,
    missingGrade,
    missingStop,
    missingProcess,
    missingNotes,
  }
}

/**
 * Canonical scoped "needs review" count for closed trades: partial + not-yet-
 * started reviews. This is the single source of truth for the main-page review
 * reminder AND the Review Queue badge, so the two always agree.
 */
export function getNeedsReviewCount(trades: Trade[]): number {
  const summary = summarizeReview(trades)
  return summary.partial + summary.needsReview
}

// ------------------------------------------------------ review-only updates

/**
 * Merge a review patch onto a trade WITHOUT touching financial/execution
 * fields. Only the review keys listed in `ReviewPatch` may change. Returns a
 * new object; never mutates the input.
 *
 * Semantics: a key that is PRESENT in the patch is written verbatim — including
 * `undefined`, which CLEARS the field (the review dialog uses `undefined` to
 * mean "user cleared this"). A key that is ABSENT is left untouched, so a
 * partial patch can never wipe unrelated review fields.
 */
export function applyReviewPatch(trade: Trade, patch: ReviewPatch): Trade {
  const next = { ...trade }
  if ("setupId" in patch) {
    if (patch.setupId === undefined) delete next.setupId
    else next.setupId = patch.setupId
  }
  if ("manualSetupGrade" in patch) {
    if (patch.manualSetupGrade === undefined) delete next.manualSetupGrade
    else next.manualSetupGrade = patch.manualSetupGrade
  }
  if ("manualProcessFollowed" in patch) {
    if (patch.manualProcessFollowed === undefined) delete next.manualProcessFollowed
    else next.manualProcessFollowed = patch.manualProcessFollowed
  }
  if ("manualMistakeIds" in patch) {
    if (patch.manualMistakeIds === undefined) delete next.manualMistakeIds
    else next.manualMistakeIds = patch.manualMistakeIds
  }
  if ("tradeThesis" in patch) {
    if (patch.tradeThesis === undefined) delete next.tradeThesis
    else next.tradeThesis = patch.tradeThesis
  }
  if ("reviewNotes" in patch) {
    if (patch.reviewNotes === undefined) delete next.reviewNotes
    else next.reviewNotes = patch.reviewNotes
  }
  return next
}

// --------------------------------------------------------- shared list utils

/** Closed trades sorted by close date/time descending (newest first). */
export function sortClosedTradesByCloseDate(trades: Trade[]): Trade[] {
  return trades.filter(isTradeClosed).sort((a, b) => {
    const aKey = `${a.endDate || a.date}|${a.endTime || a.time}`
    const bKey = `${b.endDate || b.date}|${b.endTime || b.time}`
    return bKey.localeCompare(aKey)
  })
}

/** Deduplicate a mistake id list (a trade is counted once per category). */
export function normalizeMistakeIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter((id) => id && id.length > 0))]
}

/** Close-date key used by the P&L calendar (closed trades only). */
export function getCalendarCloseDateKey(trade: Trade): string | null {
  if (!isTradeClosed(trade)) return null
  const key = getCloseDateKey(trade)
  return DATE_KEY_PATTERN.test(key) ? key : null
}
