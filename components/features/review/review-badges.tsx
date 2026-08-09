"use client"

import { Badge } from "@/components/ui/badge"
import type { Trade } from "@/types/trade"
import {
  getEffectiveStopPct,
  getManualStopPct,
  getReviewStatusLabel,
} from "@/utils/trade-review"
import { isTradeClosed } from "@/utils/quant-metrics"
import { cn } from "@/lib/utils"

/**
 * Small restrained badges for the review visual language:
 * Account (already exists elsewhere), Grade, Review, Process, Stop.
 */

function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return null
  return (
    <Badge
      variant="outline"
      className={cn(
        grade.startsWith("A")
          ? "border-green-500 text-green-700"
          : grade.startsWith("B")
            ? "border-blue-500 text-blue-700"
            : grade.startsWith("C")
              ? "border-yellow-500 text-yellow-700"
              : grade.startsWith("D")
                ? "border-orange-500 text-orange-700"
                : "border-red-500 text-red-700",
      )}
    >
      {grade}
    </Badge>
  )
}

function ReviewStatusBadge({ trade }: { trade: Trade }) {
  if (!isTradeClosed(trade)) return <Badge variant="outline">Open</Badge>
  const label = getReviewStatusLabel(trade)
  if (label === "Reviewed") return <Badge className="border-green-500 text-green-700">Reviewed</Badge>
  if (label === "Partial") return <Badge className="border-amber-500 text-amber-700">Partial</Badge>
  return <Badge className="border-red-500 text-red-700">Needs Review</Badge>
}

function ProcessBadge({ trade }: { trade: Trade }) {
  if (trade.manualProcessFollowed === true)
    return <Badge className="border-green-500 text-green-700">Followed</Badge>
  if (trade.manualProcessFollowed === false)
    return <Badge className="border-red-500 text-red-700">Violated</Badge>
  return null
}

function StopBadge({ trade }: { trade: Trade }) {
  const manual = getManualStopPct(trade) !== null
  if (manual) return <Badge variant="outline">Manual</Badge>
  if (getEffectiveStopPct(trade) !== null) return <Badge variant="secondary">Inferred</Badge>
  return <Badge variant="outline">Missing</Badge>
}

export { GradeBadge, ReviewStatusBadge, ProcessBadge, StopBadge }
