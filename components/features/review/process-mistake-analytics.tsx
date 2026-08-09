"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { calculateMistakePerformance, calculateProcessPerformance } from "@/utils/review-analytics"
import { formatDollars, formatPercent, formatR, formatRatio } from "./review-format"
import type { Trade } from "@/types/trade"

interface ProcessMistakeAnalyticsProps {
  trades: Trade[]
}

/** Process adherence (followed vs violated) and mistake-category performance. */
export function ProcessMistakeAnalytics({ trades }: ProcessMistakeAnalyticsProps) {
  const process = useMemo(() => calculateProcessPerformance(trades), [trades])
  const mistakes = useMemo(() => calculateMistakePerformance(trades), [trades])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Process Adherence</CardTitle>
          <CardDescription>
            Followed vs violated process review. Trades without a process answer are excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {process.reviewedCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No closed trades have a process review yet ({process.unreviewedCount} unreviewed).
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Expectancy R</TableHead>
                    <TableHead className="text-right">Profit Factor</TableHead>
                    <TableHead className="text-right">Net P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <Badge className="border-green-500 text-green-700">Followed</Badge>
                    </TableCell>
                    <TableCell className="text-right">{process.followed.tradeCount}</TableCell>
                    <TableCell className="text-right">{formatPercent(process.followed.reviewSharePct)}</TableCell>
                    <TableCell className="text-right">{formatPercent(process.followed.winRate)}</TableCell>
                    <TableCell className="text-right">{formatR(process.followed.expectancyR)}</TableCell>
                    <TableCell className="text-right">{formatRatio(process.followed.profitFactor)}</TableCell>
                    <TableCell className="text-right">{formatDollars(process.followed.totalNetPnl)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Badge className="border-red-500 text-red-700">Violated</Badge>
                    </TableCell>
                    <TableCell className="text-right">{process.violated.tradeCount}</TableCell>
                    <TableCell className="text-right">{formatPercent(process.violated.reviewSharePct)}</TableCell>
                    <TableCell className="text-right">{formatPercent(process.violated.winRate)}</TableCell>
                    <TableCell className="text-right">{formatR(process.violated.expectancyR)}</TableCell>
                    <TableCell className="text-right">{formatRatio(process.violated.profitFactor)}</TableCell>
                    <TableCell className="text-right">{formatDollars(process.violated.totalNetPnl)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {process.unreviewedCount} closed trade{process.unreviewedCount === 1 ? "" : "s"} without a process answer
            (excluded from both groups).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mistake Patterns</CardTitle>
          <CardDescription>
            Net P&L of trades tagged with each mistake. A trade counts once per category; this is not a cost claim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mistakes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mistakes tagged yet.</p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mistake</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Avg R</TableHead>
                    <TableHead className="text-right">Net P&L</TableHead>
                    <TableHead className="text-right">W / L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mistakes.map((mistake) => (
                    <TableRow key={mistake.mistakeId}>
                      <TableCell className="font-medium">{mistake.label}</TableCell>
                      <TableCell className="text-right">{mistake.affectedTradeCount}</TableCell>
                      <TableCell className="text-right">{formatR(mistake.avgR)}</TableCell>
                      <TableCell
                        className={`text-right ${mistake.netPnl >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatDollars(mistake.netPnl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {mistake.winCount} / {mistake.lossCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
