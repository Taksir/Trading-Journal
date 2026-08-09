"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculateSetupPerformance } from "@/utils/review-analytics"
import {
  formatDollars,
  formatPercent,
  formatR,
  formatRatio,
  SampleSizeBadge,
} from "./review-format"
import type { Setup } from "@/types/setup"
import type { Trade } from "@/types/trade"

interface SetupAnalyticsProps {
  trades: Trade[]
  setups: Setup[]
}

/** Per-setup closed-trade performance. Sort: expectancy R descending. */
export function SetupAnalytics({ trades, setups }: SetupAnalyticsProps) {
  const rows = useMemo(() => calculateSetupPerformance(trades, setups), [trades, setups])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup Analytics</CardTitle>
        <CardDescription>
          Closed-trade performance by setup. Expectancy is average net R per trade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed trades with setups to analyze.</p>
        ) : (
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setup</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Avg Win %</TableHead>
                  <TableHead className="text-right">Avg Loss %</TableHead>
                  <TableHead className="text-right">Avg Win R</TableHead>
                  <TableHead className="text-right">Avg Loss R</TableHead>
                  <TableHead className="text-right">Expectancy R</TableHead>
                  <TableHead className="text-right">Profit Factor</TableHead>
                  <TableHead className="text-right">Net P&L</TableHead>
                  <TableHead className="text-right">Max L Streak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.setupId ?? "unassigned"}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        <SampleSizeBadge count={row.tradeCount} />
                      </div>
                      {row.setupId === null && (
                        <div className="text-xs text-muted-foreground">no setup assigned</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{row.tradeCount}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.winRate)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.avgWinPct)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.avgLossPct)}</TableCell>
                    <TableCell className="text-right">{formatR(row.avgWinningR)}</TableCell>
                    <TableCell className="text-right">{formatR(row.avgLosingR)}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        row.expectancyR === null ? "" : row.expectancyR >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatR(row.expectancyR)}
                    </TableCell>
                    <TableCell className="text-right">{formatRatio(row.profitFactor)}</TableCell>
                    <TableCell className="text-right">{formatDollars(row.totalNetPnl)}</TableCell>
                    <TableCell className="text-right">{row.maxConsecutiveLosses}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
