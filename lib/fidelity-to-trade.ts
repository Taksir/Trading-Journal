import type { Trade, Settings } from "../types/trade.ts"
import { getTradingSession, getDayOfWeek, DEFAULT_TRADING_SESSIONS } from "../utils/trading-sessions.ts"
import type { FidelityRoundTrip } from "./fidelity-parser.ts"

export interface FidelityImportOptions {
  settings: Settings
}

export function formatDuration(openDate: string, openTime: string, closeDate: string, closeTime: string): string {
  const start = new Date(`${openDate}T${openTime || "00:00"}:00Z`)
  const end = new Date(`${closeDate}T${closeTime || "00:00"}:00Z`)
  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  let duration = ""
  if (days > 0) duration += `${days}d `
  if (hours > 0) duration += `${hours}h `
  if (minutes > 0) duration += `${minutes}m `
  return duration.trim() || "<1m"
}

export function convertFidelityRoundTripToTrade(
  roundTrip: FidelityRoundTrip,
  options: FidelityImportOptions
): Omit<Trade, "id"> {
  const { settings } = options
  const tradeType: "Long" | "Short" = "Long"

  // Fidelity exports carry no stop-loss data, so we do NOT fabricate a stop,
  // an ideal risk, or an R-multiple for imported trades. Risk fields are left
  // at 0 ("no data available") and the canonical trade-review logic
  // (applyStopInfo) decides stop inference afterwards: a manual stop once the
  // user edits the trade, or an inferred stop for closed losing trades.
  const stopLoss = 0

  const riskAmount = 0
  const actualRiskAmount = riskAmount + roundTrip.fee
  const rMultiple = riskAmount > 0 ? roundTrip.pnl / riskAmount : 0
  const idealRiskAmount = 0
  const expectedR = idealRiskAmount > 0 ? roundTrip.pnl / idealRiskAmount : 0
  const riskDeviation = idealRiskAmount > 0 ? ((actualRiskAmount - idealRiskAmount) / idealRiskAmount) * 100 : 0

  const isOverRisked = false
  const isUnderRisked = false

  const balance = settings?.accountBalance || 0
  const riskPercent = balance > 0 ? (actualRiskAmount / balance) * 100 : 0

  let outcome: "Win" | "Loss" | "Breakeven" = "Breakeven"
  if (roundTrip.pnl > 0.01) outcome = "Win"
  else if (roundTrip.pnl < -0.01) outcome = "Loss"

  let grade = "C"
  if (outcome === "Win") grade = "A"
  else if (outcome === "Loss") grade = "D"

  const tradingSessions =
    settings?.tradingSessions && Array.isArray(settings.tradingSessions) && settings.tradingSessions.length > 0
      ? settings.tradingSessions
      : DEFAULT_TRADING_SESSIONS
  const session = getTradingSession(roundTrip.openTime, tradingSessions).name
  const dayOfWeek = getDayOfWeek(roundTrip.openDate)

  const riskNote = " Risk metrics need a stop loss - edit this trade to set one."

  return {
    date: roundTrip.openDate,
    time: roundTrip.openTime,
    endDate: roundTrip.closeDate,
    endTime: roundTrip.closeTime,
    asset: roundTrip.symbol,
    tradeType,
    entryPrice: Number(roundTrip.avgEntryPrice.toFixed(4)),
    exitPrice: Number(roundTrip.avgExitPrice.toFixed(4)),
    stopLoss: Number(stopLoss.toFixed(4)),
    takeProfit: 0,
    positionSize: roundTrip.shares,
    riskPercent: Number(riskPercent.toFixed(2)),
    rMultiple: Number(rMultiple.toFixed(2)),
    pnl: Number(roundTrip.pnl.toFixed(2)),
    fee: Number(roundTrip.fee.toFixed(2)),
    riskAmount: Number(riskAmount.toFixed(2)),
    idealRiskAmount,
    actualRiskAmount: Number(actualRiskAmount.toFixed(2)),
    riskDeviation: Number(riskDeviation.toFixed(2)),
    expectedR: Number(expectedR.toFixed(2)),
    isOverRisked,
    isUnderRisked,
    duration: formatDuration(roundTrip.openDate, roundTrip.openTime, roundTrip.closeDate, roundTrip.closeTime),
    system: "Fidelity",
    timeframe: "",
    notes: `Imported from Fidelity. ${roundTrip.shares} shares of ${roundTrip.symbol}.${riskNote}`,
    tags: ["Fidelity"],
    outcome,
    grade,
    ticket: roundTrip.ticket,
    session,
    dayOfWeek,
  }
}
