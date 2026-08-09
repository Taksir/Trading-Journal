"use client"

import { useMemo } from "react"
import {
  DollarSign,
  Percent,
  TrendingUp,
  TrendingDown,
  Scale,
  Gauge,
  Coins,
  Activity,
  Shield,
  ChartNoAxesCombined,
  ListOrdered,
  Layers,
} from "lucide-react"
import type { BalanceAdjustment, Settings, Trade } from "@/types/trade"
import {
  calculateAdjustedAccountBalance,
  calculateNetTradingPnL,
  calculateQuantMetrics,
} from "@/utils/quant-metrics"
import { StatsCard } from "./stats-card"
import { TooltipProvider } from "@/components/ui/tooltip"

interface QuantMetricsGridProps {
  trades: Trade[]
  settings: Settings
  balanceAdjustments?: BalanceAdjustment[]
}

const MISSING = "—"

function formatPercent(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value.toFixed(decimals)}%`
}

function formatSignedPercent(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

function formatRatio(value: number | null): string {
  if (value === null) return MISSING
  if (!Number.isFinite(value)) return "∞"
  return value.toFixed(2)
}

function formatR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`
}

function formatSignedDollars(value: number): string {
  if (!Number.isFinite(value)) return MISSING
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`
}

export function QuantMetricsGrid({ trades, settings, balanceAdjustments }: QuantMetricsGridProps) {
  const metrics = useMemo(() => calculateQuantMetrics(trades, settings), [trades, settings])
  const adjustedBalance = useMemo(
    () => calculateAdjustedAccountBalance(trades, settings, balanceAdjustments),
    [trades, settings, balanceAdjustments],
  )
  const netTradingPnL = useMemo(() => calculateNetTradingPnL(trades), [trades])

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatsCard
          title="Account Balance"
          value={`$${adjustedBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<DollarSign className="h-4 w-4" />}
          description={`${formatSignedDollars(netTradingPnL)} net P&L from trading`}
          tooltip="Current adjusted account balance including deposits, withdrawals and trading P&L."
        />

        <StatsCard
          title="Win Rate"
          value={formatPercent(metrics.winRate, 1)}
          icon={<Percent className="h-4 w-4" />}
          trend={metrics.winRate === null ? "neutral" : metrics.winRate >= 50 ? "positive" : "negative"}
          description={`${metrics.winningTrades}W / ${metrics.losingTrades}L / ${metrics.breakevenTrades}BE`}
          tooltip="Share of closed trades with positive net P&L."
        />

        <StatsCard
          title="Average Win %"
          value={formatSignedPercent(metrics.avgWinPct)}
          icon={<TrendingUp className="h-4 w-4" />}
          trend={metrics.avgWinPct === null ? "neutral" : "positive"}
          description="Average net return of profitable trades"
          tooltip="Average net return of profitable trades (P&L / position notional, net of fees)."
        />

        <StatsCard
          title="Average Loss %"
          value={formatSignedPercent(metrics.avgLossPct)}
          icon={<TrendingDown className="h-4 w-4" />}
          trend="negative"
          description="Average net return of losing trades"
          tooltip="Average net return of losing trades (P&L / position notional, net of fees)."
        />

        <StatsCard
          title="Payoff Ratio"
          value={metrics.payoffRatio === null ? MISSING : metrics.payoffRatio === Number.POSITIVE_INFINITY ? "∞x" : `${metrics.payoffRatio.toFixed(2)}x`}
          icon={<Scale className="h-4 w-4" />}
          trend={metrics.payoffRatio === null ? "neutral" : metrics.payoffRatio >= 1 ? "positive" : "negative"}
          description={`Avg ${formatR(metrics.avgWinningR)} / ${formatR(metrics.avgLosingR)}`}
          tooltip="Average winning R divided by the absolute average losing R."
        />

        <StatsCard
          title="Expectancy"
          value={metrics.expectancyR === null ? MISSING : `${formatR(metrics.expectancyR)}/trade`}
          icon={<Gauge className="h-4 w-4" />}
          trend={metrics.expectancyR === null ? "neutral" : metrics.expectancyR >= 0 ? "positive" : "negative"}
          description="Average net R per closed trade"
          tooltip="Realized net R expectancy per trade across all closed trades."
        />

        <StatsCard
          title="Profit Factor"
          value={formatRatio(metrics.profitFactor)}
          icon={<Coins className="h-4 w-4" />}
          trend={metrics.profitFactor === null ? "neutral" : metrics.profitFactor >= 1 ? "positive" : "negative"}
          description="Gross profit / gross loss"
          tooltip="Gross profit divided by gross loss, both net of fees. Infinity means no losing trades."
        />

        <StatsCard
          title="Sharpe Ratio"
          value={formatRatio(metrics.sharpeRatio)}
          icon={<Activity className="h-4 w-4" />}
          trend={metrics.sharpeRatio === null ? "neutral" : metrics.sharpeRatio > 0 ? "positive" : "negative"}
          description="Annualized, realized-P&L based"
          tooltip="Annualized risk-adjusted return using realized daily account returns (252-day)."
        />

        <StatsCard
          title="Sortino Ratio"
          value={formatRatio(metrics.sortinoRatio)}
          icon={<Shield className="h-4 w-4" />}
          trend={metrics.sortinoRatio === null ? "neutral" : metrics.sortinoRatio > 0 ? "positive" : "negative"}
          description="Downside volatility only"
          tooltip="Annualized return relative to downside volatility only (0% target, realized daily returns)."
        />

        <StatsCard
          title="Max Drawdown"
          value={formatPercent(metrics.maxDrawdownPct === null ? null : Math.abs(metrics.maxDrawdownPct))}
          icon={<ChartNoAxesCombined className="h-4 w-4" />}
          trend="negative"
          description={`Worst peak-to-trough decline${metrics.maxDrawdownAmount <= 0 ? ` • ${formatSignedDollars(metrics.maxDrawdownAmount)}` : ""}`}
          tooltip="Largest peak-to-trough decline in the trading equity curve."
        />

        <StatsCard
          title="Max Loss Streak"
          value={`${metrics.maxConsecutiveLosses}`}
          icon={<ListOrdered className="h-4 w-4" />}
          description={`Current streak: ${metrics.currentConsecutiveLosses}`}
          tooltip="Largest number of consecutive losing trades (breakevens reset the streak)."
        />

        <StatsCard
          title="Total Trades"
          value={`${metrics.totalTrades}`}
          icon={<Layers className="h-4 w-4" />}
          description={`${metrics.winningTrades} wins • ${metrics.losingTrades} losses • ${metrics.breakevenTrades} breakeven`}
          tooltip="Number of closed trades in the journal."
        />
      </div>
    </TooltipProvider>
  )
}
