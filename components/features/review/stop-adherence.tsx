"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { calculateStopAdherence, STOP_ADHERENCE_TOLERANCE_PP } from "@/utils/review-analytics"
import { formatPercent, formatPp } from "./review-format"
import type { Trade } from "@/types/trade"

interface StopAdherenceProps {
  trades: Trade[]
}

function Metric({ label, value, note, positive }: { label: string; value: string; note?: string; positive?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${positive === undefined ? "" : positive ? "text-green-600" : "text-red-600"}`}>
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
    </div>
  )
}

/** Stop adherence for closed LOSING trades with a manually planned stop. */
export function StopAdherence({ trades }: StopAdherenceProps) {
  const metrics = useMemo(() => calculateStopAdherence(trades), [trades])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stop Adherence</CardTitle>
        <CardDescription>
          Closed losing trades, compared against their MANUALLY planned stop. Deviation is in percentage points (p.p.).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Metric
            label="Manual stop coverage"
            value={metrics.totalLosing > 0 ? formatPercent(metrics.coveragePct) : "—"}
            note={`${metrics.losingWithManualStop} of ${metrics.totalLosing} losing trades`}
            positive={(metrics.coveragePct || 0) >= 50}
          />
          <Metric
            label="Avg planned stop"
            value={formatPercent(metrics.avgPlannedStopPct, 2)}
            note="manual stops only"
          />
          <Metric
            label="Avg realized loss"
            value={formatPercent(metrics.avgRealizedLossPct, 2)}
            note="losing trades with manual stop"
          />
          <Metric
            label="Avg deviation"
            value={formatPp(metrics.avgDeviationPct)}
            note="+ means lost more than planned"
            positive={(metrics.avgDeviationPct || 0) <= 0}
          />
          <Metric
            label="Exceeded stop"
            value={`${metrics.exceedingCount}${metrics.losingWithManualStop > 0 ? ` (${formatPercent(metrics.exceedingPct)})` : ""}`}
            note={`lost more than planned`}
            positive={metrics.exceedingCount === 0}
          />
          <Metric
            label="Within tolerance"
            value={`${metrics.containedCount}${metrics.losingWithManualStop > 0 ? ` (${formatPercent(metrics.containedPct)})` : ""}`}
            note={`±${STOP_ADHERENCE_TOLERANCE_PP.toFixed(2)} p.p.`}
            positive={metrics.containedCount > 0}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {metrics.favorableCount > 0
            ? `${metrics.favorableCount} losing trade${metrics.favorableCount === 1 ? "" : "s"} stopped out tighter than planned (favorable deviation). `
            : ""}
          Inferred stops (back-computed from the realized loss) are excluded — comparing a loss to itself would be
          circular. Open trades and breakevens never count as stop-adherence losses.
        </p>
      </CardContent>
    </Card>
  )
}
