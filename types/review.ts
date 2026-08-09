import type { ManualSetupGrade } from "./trade.ts"

/**
 * Structured human review model.
 *
 * Design notes:
 * - Mistake IDs are STABLE. Never rename or re-purpose an id once it exists in
 *   journals; new mistakes are APPENDED to the catalog.
 * - `manualMistakeIds` is the human's own assessment of a trade. A future
 *   automated reviewer will write its own fields (`automatedReview`), never the
 *   manual ones, so human data is never overwritten by automation.
 * - Multiple mistakes per trade are allowed. Each trade is counted once per
 *   category in analytics.
 * - Process review is a tri-state on the trade: `manualProcessFollowed` is
 *   `true` (followed), `false` (violated) or absent (not yet reviewed).
 */

export const MISTAKE_IDS = {
  chasedEntry: "mistake-chased-entry",
  enteredTooEarly: "mistake-entered-early",
  enteredTooLate: "mistake-entered-late",
  oversizedPosition: "mistake-oversized",
  brokeStop: "mistake-broke-stop",
  movedStopWider: "mistake-moved-stop-wider",
  tookProfitTooEarly: "mistake-tp-early",
  heldTooLong: "mistake-held-too-long",
  ignoredMarketConditions: "mistake-ignored-market",
  ignoredSetupRules: "mistake-ignored-setup-rules",
  addedPoorly: "mistake-added-poorly",
  revengeEmotional: "mistake-revenge-emotional",
  other: "mistake-other",
} as const

export type MistakeId = (typeof MISTAKE_IDS)[keyof typeof MISTAKE_IDS]

export interface MistakeDefinition {
  id: MistakeId
  label: string
}

export const MISTAKES: MistakeDefinition[] = [
  { id: MISTAKE_IDS.chasedEntry, label: "Chased Entry" },
  { id: MISTAKE_IDS.enteredTooEarly, label: "Entered Too Early" },
  { id: MISTAKE_IDS.enteredTooLate, label: "Entered Too Late" },
  { id: MISTAKE_IDS.oversizedPosition, label: "Oversized Position" },
  { id: MISTAKE_IDS.brokeStop, label: "Broke Stop" },
  { id: MISTAKE_IDS.movedStopWider, label: "Moved Stop Wider" },
  { id: MISTAKE_IDS.tookProfitTooEarly, label: "Took Profit Too Early" },
  { id: MISTAKE_IDS.heldTooLong, label: "Held Too Long" },
  { id: MISTAKE_IDS.ignoredMarketConditions, label: "Ignored Market Conditions" },
  { id: MISTAKE_IDS.ignoredSetupRules, label: "Ignored Setup Rules" },
  { id: MISTAKE_IDS.addedPoorly, label: "Added Poorly" },
  { id: MISTAKE_IDS.revengeEmotional, label: "Revenge / Emotional Trade" },
  { id: MISTAKE_IDS.other, label: "Other" },
]

/** Display label for a mistake id. Unknown/custom ids fall back to the id. */
export function getMistakeLabel(id: string | undefined | null): string | null {
  if (!id) return null
  const found = MISTAKES.find((mistake) => mistake.id === id)
  return found ? found.label : id
}

/** Review status of a CLOSED trade. See utils/trade-review.ts for criteria. */
export type TradeReviewStatus = "complete" | "partial" | "needs-review"

/**
 * Review-only patch. A review editor may only touch these keys — never
 * financial/execution fields (entry, exit, quantity, pnl, dates, broker data).
 */
export interface ReviewPatch {
  setupId?: string
  manualSetupGrade?: ManualSetupGrade
  manualProcessFollowed?: boolean
  manualMistakeIds?: string[]
  tradeThesis?: string
  reviewNotes?: string
}
