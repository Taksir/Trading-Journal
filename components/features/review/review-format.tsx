import { Badge } from "@/components/ui/badge"
import { getSampleSizeBand, SAMPLE_SIZE_LABELS, type SampleSizeBand } from "@/utils/review-analytics"

/** Formatting helpers shared by the review analytics sections. */

export const MISSING = "—"

export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value.toFixed(decimals)}%`
}

export function formatSignedPercent(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

export function formatR(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}R`
}

export function formatRatio(value: number | null): string {
  if (value === null) return MISSING
  if (!Number.isFinite(value)) return "∞"
  return value.toFixed(2)
}

export function formatDollars(value: number): string {
  if (!Number.isFinite(value)) return MISSING
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`
}

/** Percentage points with an explicit sign. */
export function formatPp(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)} p.p.`
}

export function sampleSizeBadgeBand(n: number): SampleSizeBand {
  return getSampleSizeBand(n)
}

/** Small warning chip shown when a group is too small to trust. */
export function SampleSizeBadge({ count }: { count: number }) {
  const band = getSampleSizeBand(count)
  if (!band) return null
  return (
    <Badge variant={band === "very-small" ? "destructive" : "outline"} className="text-[10px]">
      {SAMPLE_SIZE_LABELS[band]}
    </Badge>
  )
}
