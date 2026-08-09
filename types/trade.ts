export interface Trade {
  id: string
  /** Stable id of the TradingAccount this trade belongs to (see types/account.ts). */
  accountId?: string
  date: string
  time: string
  endDate?: string // Optional for trades that are still open
  endTime?: string // Optional for trades that are still open
  asset: string
  tradeType: "Long" | "Short"
  entryPrice: number
  exitPrice: number
  stopLoss: number
  takeProfit: number // Keep for backward compatibility but not used
  positionSize: number
  riskPercent: number
  rMultiple: number
  pnl: number
  fee: number
  riskAmount: number
  idealRiskAmount: number // New: Expected risk amount for this trade
  actualRiskAmount: number // New: Actual risk including fees
  riskDeviation: number // New: Percentage deviation from ideal
  expectedR: number // New: R calculated based on ideal risk
  isOverRisked: boolean // New: Whether trade exceeded risk tolerance
  isUnderRisked: boolean // New: Whether trade was under-risked
  duration: string
  system: string
  timeframe: string
  notes: string
  tags: string[]
  screenshot?: string
  outcome: "Win" | "Loss" | "Breakeven"
  grade: string // Execution/risk grade used by the risk-management calculations
  ticket?: string
  session: string
  dayOfWeek: string

  // ---- Setup classification (see types/setup.ts) ----
  setupId?: string

  // ---- Human review fields (never overwritten by automation) ----
  /** Human judgment of setup quality. Distinct from `grade` and from future automated grades. */
  manualSetupGrade?: ManualSetupGrade
  /** Why I took the trade / what I expected. */
  tradeThesis?: string
  /** Post-trade observations. */
  reviewNotes?: string
  /** Whether I followed my trading process. `true`/`false`; absent = not yet reviewed. */
  manualProcessFollowed?: boolean
  /** Stable mistake ids made on this trade (see types/review.ts MISTAKE_IDS). Multiple allowed. */
  manualMistakeIds?: string[]

  // ---- Stop tracking ----
  /** Manually specified stop price. Mirrors `stopLoss` when a stop is known. */
  plannedStopPrice?: number
  /** Planned stop distance in percent of entry. May be manually specified or inferred. */
  plannedStopPct?: number
  /** Distinguishes a manual stop from an inferred stop from "no stop information". */
  stopSource?: StopSource
  /** Realized-loss-based inferred stop (convenience approximation, not historical truth). */
  inferredStopPct?: number
}

export interface TradeStats {
  totalTrades: number
  winRate: number
  totalPnL: number
  averageR: number
  averageExpectedR: number // New: Average based on expected R
  expectedValue: number // New: Expected Value (EV) - same as averageExpectedR
  profitFactor: number
  expectancy: number
  expectedExpectancy: number // New: Expectancy based on expected R
  totalR: number
  totalExpectedR: number // New: Total expected R
  winningTrades: number
  losingTrades: number
  largestWin: number
  largestLoss: number
  totalFees: number
  totalRisk: number
  totalIdealRisk: number // New: Total ideal risk
  overRiskedTrades: number // New: Count of over-risked trades
  underRiskedTrades: number // New: Count of under-risked trades
  avgRiskDeviation: number // New: Average risk deviation
}

export interface FilterOptions {
  system?: string
  systems?: string[] // New: Multi-select systems
  timeframe?: string
  timeframes?: string[] // New: Multi-select timeframes
  outcome?: string
  dateFrom?: string
  dateTo?: string
  tags?: string[]
  grade?: string
  grades?: string[] // New: Multi-select grades
  session?: string
  sessions?: string[] // New: Multi-select sessions
  dayOfWeek?: string
  daysOfWeek?: string[] // New: Multi-select days of week
  riskDeviation?: "over" | "under" | "good" // New: Filter by risk deviation
  minR?: number // New: Minimum R-multiple filter
  maxR?: number // New: Maximum R-multiple filter
  minPnL?: number // New: Minimum P&L filter
  maxPnL?: number // New: Maximum P&L filter
  setupId?: string // Review: filter by setup id
  manualGrade?: string // Review: filter by manual setup grade
  processFollowed?: "followed" | "violated" // Review: filter by process review
  reviewStatus?: "reviewed" | "partial" | "needs-review" | "open" // Review: filter by review status
}

export interface TradingSession {
  name: string
  startTime: string // HH:MM format
  endTime: string // HH:MM format
  color: string
  description: string
}

export interface Settings {
  accountBalance: number
  assetFees: Record<string, number>
  tradingSystems: string[]
  tradingSessions: TradingSession[]
  riskDeviationTolerance: number // New: Percentage tolerance for risk deviation (default 10%)
  systemIdealRisk: Record<string, number> // New: Ideal risk amount per system
  defaultIdealRisk: number // New: Default ideal risk amount
}

export interface BrokerTrade {
  ticket: string
  opening_time_utc: string
  closing_time_utc: string
  type: string
  lots: string
  symbol: string
  opening_price: string
  closing_price: string
  stop_loss: string
  take_profit: string
  commission_usd: string
  profit_usd: string
  close_reason: string
}

export interface BalanceAdjustment {
  id: string
  /** Stable id of the TradingAccount this adjustment belongs to. */
  accountId?: string
  amount: number
  reason: string
  type: "add" | "subtract"
  date: string
  time: string
  notes?: string
}

/** Human-judgment setup grade. Distinct from the automated/risk `grade` field. */
export type ManualSetupGrade = "A+" | "A" | "B" | "C" | "D" | "F" | null

/** How a trade's planned stop was obtained. */
export type StopSource = "manual" | "inferred" | "none"
