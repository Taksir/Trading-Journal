"use client"

import { Badge } from "@/components/ui/badge"
import { GradeBadge, ProcessBadge, StopBadge } from "./review-badges"
import { getMistakeLabel } from "@/types/review"
import { getSetupName } from "@/utils/setups"
import { getReviewStatusLabel } from "@/utils/trade-review"
import type { Setup } from "@/types/setup"
import type { Trade } from "@/types/trade"

interface ReviewDetailsProps {
  trade: Trade
  setups?: Setup[]
}

/** Read-only summary of the human review for a trade. */
export function ReviewDetails({ trade, setups = [] }: ReviewDetailsProps) {
  const setupName = getSetupName(setups, trade.setupId)
  const mistakes = (trade.manualMistakeIds || []).map(getMistakeLabel).filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={trade.manualSetupGrade} />
        <ProcessBadge trade={trade} />
        <StopBadge trade={trade} />
        <Badge variant="outline">{getReviewStatusLabel(trade)}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold text-muted-foreground">Setup</p>
          <p>{setupName || "Not assigned"}</p>
        </div>
        <div>
          <p className="font-semibold text-muted-foreground">Manual Setup Grade</p>
          <p>{trade.manualSetupGrade || "Not graded"}</p>
        </div>
        <div>
          <p className="font-semibold text-muted-foreground">Process</p>
          <p>
            {trade.manualProcessFollowed === true
              ? "Followed"
              : trade.manualProcessFollowed === false
                ? "Violated"
                : "Not reviewed"}
          </p>
        </div>
        <div>
          <p className="font-semibold text-muted-foreground">Planned Stop</p>
          <p>
            {trade.stopSource === "manual"
              ? `Manual ${getPlannedStopPct(trade)}`
              : trade.stopSource === "inferred"
                ? "Inferred"
                : "Missing"}
          </p>
        </div>
      </div>

      {trade.tradeThesis ? (
        <div>
          <p className="font-semibold text-muted-foreground">Thesis</p>
          <p className="text-sm">{trade.tradeThesis}</p>
        </div>
      ) : null}

      {trade.reviewNotes ? (
        <div>
          <p className="font-semibold text-muted-foreground">Review Notes</p>
          <p className="text-sm">{trade.reviewNotes}</p>
        </div>
      ) : null}

      {mistakes.length > 0 ? (
        <div>
          <p className="font-semibold text-muted-foreground">Mistakes</p>
          <div className="flex flex-wrap gap-2">
            {mistakes.map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getPlannedStopPct(trade: Trade): string {
  if (trade.plannedStopPct && Number.isFinite(trade.plannedStopPct)) return `${trade.plannedStopPct.toFixed(2)}%`
  return ""
}
