"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { GradeBadge } from "./review-badges"
import { calculateGradePerformance } from "@/utils/review-analytics"
import {
  formatDollars,
  formatPercent,
  formatR,
  formatRatio,
  SampleSizeBadge,
} from "./review-format"
import type { Trade } from "@/types/trade"

interface GradeAnalyticsProps {
  trades: Trade[]
}

/** Per manual-setup-grade performance. Ungraded trades stay separate. */
export function GradeAnalytics({ trades }: GradeAnalyticsProps) {
  const result = useMemo(() => calculateGradePerformance(trades), [trades])
  const rows = result.buckets

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grade Analytics</CardTitle>
        <CardDescription>
          Performance by manual setup grade. Trades without a manual grade are reported separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed trades with a manual setup grade yet.</p>
        ) : (
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Expectancy R</TableHead>
                  <TableHead className="text-right">Profit Factor</TableHead>
                  <TableHead className="text-right">Avg Win %</TableHead>
                  <TableHead className="text-right">Avg Loss %</TableHead>
                  <TableHead className="text-right">Net P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.grade}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <GradeBadge grade={row.grade} />
                        <SampleSizeBadge count={row.tradeCount} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{row.tradeCount}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.winRate)}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        row.expectancyR === null ? "" : row.expectancyR >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatR(row.expectancyR)}
                    </TableCell>
                    <TableCell className="text-right">{formatRatio(row.profitFactor)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.avgWinPct)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.avgLossPct)}</TableCell>
                    <TableCell className="text-right">{formatDollars(row.totalNetPnl)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {result.ungraded && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <GradeBadge grade={null} />
            <span className="text-muted-foreground">Ungraded trades (no manual setup grade):</span>
            <span className="font-medium">{result.ungraded.tradeCount} trades</span>
            <span
              className={`font-medium ${(result.ungraded.expectancyR || 0) >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {formatR(result.ungraded.expectancyR)} expectancy
            </span>
            <span>{formatDollars(result.ungraded.totalNetPnl)} net P&L</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
