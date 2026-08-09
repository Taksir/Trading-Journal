"use client"

import { useState, useEffect, useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Plus, DollarSign, Upload, Download, Settings, Trash2 } from "lucide-react"
import { TradeEntryForm, TradesList, AnalyticsDashboard } from "@/components/index"
import { AdvancedAnalytics } from "@/components/advanced-analytics"
import { SessionAnalytics } from "@/components/session-analytics"
import { SystemReports } from "@/components/system-reports"
import { SettingsPanel } from "@/components/settings-panel"
import { ImportDialog } from "@/components/import-dialog"
import { BalanceAdjuster } from "@/components/balance-adjuster"
import { AccountSelector } from "@/components/features/accounts/account-selector"
import { AccountManager } from "@/components/features/accounts/account-manager"
import { ReviewQueue } from "@/components/features/review/review-queue"
import { QuickReviewDialog } from "@/components/features/review/quick-review-dialog"
import { TradeDetailDialog } from "@/components/features/review/trade-detail-dialog"
import { SetupAnalytics } from "@/components/features/review/setup-analytics"
import { GradeAnalytics } from "@/components/features/review/grade-analytics"
import { ProcessMistakeAnalytics } from "@/components/features/review/process-mistake-analytics"
import { StopAdherence } from "@/components/features/review/stop-adherence"
import { PnlCalendar } from "@/components/features/review/pnl-calendar"
import type { Trade, TradeStats, Settings as SettingsType, BalanceAdjustment } from "@/types/trade"
import type { AccountScope, TradingAccount } from "@/types/account"
import type { ReviewPatch } from "@/types/review"
import { DEFAULT_SETUPS, type Setup } from "@/types/setup"
import { recalculateTradeMetrics } from "@/utils/trade-calculations"
import { calculateAdjustedAccountBalance, calculateNetTradingPnL, isTradeClosed } from "@/utils/quant-metrics"
import { QuantMetricsGrid } from "@/components/features/analytics/quant-metrics-grid"
import { FeeAnalysis } from "@/components/fee-analysis"
import {
  ACCOUNTS_STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_ACCOUNT_ID,
  SCHEMA_VERSION_KEY,
  accountHasAdjustments,
  accountHasTrades,
  ensureAccountsMigration,
  persistMigratedJournal,
} from "@/utils/account-migration"
import { createId } from "@/utils/ids"
import {
  buildFullBackup,
  downloadFile,
  normalizeRestoredScope,
  parseBackup,
  serializeFullBackup,
  validateBackup,
  type FullBackup,
  type RestoreResult,
} from "@/lib/export-import"
import {
  buildAccountDailySeries,
  buildAggregateDailySeries,
  filterAdjustmentsByScope,
  filterTradesByScope,
} from "@/utils/account-analytics"
import { scopeAccounts } from "@/utils/account-scope"
import { mergeSetups, SETUPS_STORAGE_KEY } from "@/utils/setups"
import {
  applyReviewPatch as applyReviewPatchToTrade,
  sortClosedTradesByCloseDate,
} from "@/utils/review-analytics"
import { needsReview } from "@/utils/trade-review"
import {
  groupClosedTradesByCloseDate,
  toCalendarDayPoints,
  type CalendarDayPoint,
} from "@/utils/calendar-analytics"

const ACCOUNT_SCOPE_KEY = "trading-journal-account-scope"

const DEFAULT_SETTINGS: SettingsType = {
  accountBalance: 100,
  assetFees: {
    BTC: 16,
    ETH: 1.3,
    Gold: 11,
    XAU: 11,
  },
  tradingSystems: [
    "Z-score",
    "EMT",
    "NYC Breakout",
    "London Open",
    "Scalping",
    "Swing Trading",
    "Mean Reversion",
    "Momentum",
    "Breakout",
    "Other",
  ],
  tradingSessions: [
    { name: "Day Open", startTime: "00:00", endTime: "06:59", color: "#3B82F6", description: "Day Open Session" },
    { name: "London", startTime: "07:00", endTime: "12:59", color: "#10B981", description: "London Session" },
    { name: "New York", startTime: "13:00", endTime: "19:59", color: "#F59E0B", description: "New York Session" },
    { name: "N/A", startTime: "20:00", endTime: "23:59", color: "#EF4444", description: "N/A Session" },
  ],
  riskDeviationTolerance: 10,
  systemIdealRisk: {},
  defaultIdealRisk: 1,
}

export default function TradingJournal() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [balanceAdjustments, setBalanceAdjustments] = useState<BalanceAdjustment[]>([])
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [setups, setSetups] = useState<Setup[]>(DEFAULT_SETUPS)
  const [selectedAccountScope, setSelectedAccountScope] = useState<AccountScope>({ kind: "all" })
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  const [showTradeForm, setShowTradeForm] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showBalanceAdjuster, setShowBalanceAdjuster] = useState(false)
  const [showAccountManager, setShowAccountManager] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<Trade | null>(null)
  const [detailTarget, setDetailTarget] = useState<Trade | null>(null)
  // Persistence effects no-op until load+migrate completes, so the initial
  // empty React state can never overwrite existing storage during startup.
  const [isHydrated, setIsHydrated] = useState(false)
  // Set when storage holds a NEWER schema than this build: load read-only,
  // refuse to persist (no destructive rewrite or downgrade).
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null)
  // Set when migrated data could not be persisted (e.g. localStorage full).
  // Same read-only consequences: no writes, no hydration, edits blocked.
  const [storageError, setStorageError] = useState<string | null>(null)

  // Single centralized read-only guard. When active, NO journal mutation is
  // allowed: every mutating handler calls `guardWrite` first, so edits can
  // never appear to save and then silently vanish on refresh. View-only
  // actions (filter, sort, scope selection, analytics, export) stay usable.
  const readOnly = schemaWarning !== null || storageError !== null
  const guardWrite = (action: string): boolean => {
    if (!readOnly) return true
    window.alert(
      `This journal is open read-only because it was created by a newer app version or its data could not be saved to local storage. ` +
        `${action} is disabled so nothing can be modified unsafely or lost on refresh.`,
    )
    return false
  }

  // Load data from localStorage on component mount
  useEffect(() => {
    const savedTrades = localStorage.getItem("trading-journal-trades")
    const savedSettings = localStorage.getItem("trading-journal-settings")
    const savedAdjustments = localStorage.getItem("trading-journal-balance-adjustments")
    const savedAccounts = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    const savedScope = localStorage.getItem(ACCOUNT_SCOPE_KEY)
    const savedSetups = localStorage.getItem(SETUPS_STORAGE_KEY)

    // Future-schema fail-safe: a stored version greater than the current one
    // means a newer app wrote this data. Load read-only and warn instead of
    // rewriting or downgrading it.
    let storedSchemaVersion: number | null = null
    try {
      const rawVersion = localStorage.getItem(SCHEMA_VERSION_KEY)
      if (rawVersion !== null) {
        const parsedVersion = Number(rawVersion)
        if (Number.isFinite(parsedVersion)) storedSchemaVersion = parsedVersion
      }
    } catch (error) {
      console.error("Error reading schema version:", error)
    }
    const futureSchema = storedSchemaVersion !== null && storedSchemaVersion > CURRENT_SCHEMA_VERSION
    if (futureSchema) {
      setSchemaWarning(
        `This journal was saved by a newer version of the app (schema v${storedSchemaVersion}, this build supports v${CURRENT_SCHEMA_VERSION}). ` +
          "It is loaded read-only: changes will not be saved so your newer data is not rewritten or downgraded.",
      )
    }

    let loadedTrades: Trade[] = []
    let loadedSettings: SettingsType = DEFAULT_SETTINGS
    let loadedAdjustments: BalanceAdjustment[] = []
    let loadedAccounts: TradingAccount[] = []
    let loadedSetups: Setup[] = DEFAULT_SETUPS

    if (savedSetups) {
      try {
        loadedSetups = mergeSetups(JSON.parse(savedSetups))
      } catch (error) {
        console.error("Error loading setups:", error)
      }
    }

    if (savedTrades) {
      try {
        loadedTrades = JSON.parse(savedTrades)
      } catch (error) {
        console.error("Error loading trades:", error)
      }
    }

    if (savedSettings) {
      try {
        loadedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }
      } catch (error) {
        console.error("Error loading settings:", error)
      }
    }

    if (savedAdjustments) {
      try {
        loadedAdjustments = JSON.parse(savedAdjustments)
      } catch (error) {
        console.error("Error loading balance adjustments:", error)
      }
    }

    if (savedAccounts) {
      try {
        loadedAccounts = JSON.parse(savedAccounts)
      } catch (error) {
        console.error("Error loading accounts:", error)
      }
    }

    // Migrate legacy data (trades/adjustments without an accountId) into a
    // default account. Idempotent: running it on already-migrated data is a
    // no-op that returns the same references. Skipped for future-schema data
    // so nothing is rewritten by an older build.
    if (!futureSchema) {
      const migrated = ensureAccountsMigration({
        trades: loadedTrades,
        settings: loadedSettings,
        balanceAdjustments: loadedAdjustments,
        accounts: loadedAccounts,
      })
      if (migrated.trades !== loadedTrades) loadedTrades = migrated.trades
      if (migrated.balanceAdjustments !== loadedAdjustments) loadedAdjustments = migrated.balanceAdjustments
      loadedAccounts = migrated.accounts
    }

    setTrades(loadedTrades)
    setSettings(loadedSettings)
    setBalanceAdjustments(loadedAdjustments)
    setAccounts(loadedAccounts)
    setSetups(loadedSetups)

    if (savedScope) {
      try {
        const parsedScope = JSON.parse(savedScope)
        if (parsedScope && (parsedScope.kind === "all" || parsedScope.kind === "selected")) {
          setSelectedAccountScope(parsedScope)
        }
      } catch (error) {
        console.error("Error loading account scope:", error)
      }
    }

    // Durable ordering (see persistMigratedJournal): the migrated journal is
    // persisted FIRST, and the schema version is the FINAL durable write. So
    // `schemaVersion == current` in storage always implies the migrated data
    // is already on disk — never merely in React state. On any write failure
    // the version is not advanced, hydration stays locked (retry next load),
    // and a read-only banner + guard are activated so nothing is lost.
    if (!futureSchema) {
      const outcome = persistMigratedJournal({
        storedSchemaVersion,
        storage: window.localStorage,
        entries: [
          { key: "trading-journal-trades", value: JSON.stringify(loadedTrades) },
          { key: ACCOUNTS_STORAGE_KEY, value: JSON.stringify(loadedAccounts) },
          { key: "trading-journal-balance-adjustments", value: JSON.stringify(loadedAdjustments) },
          { key: SETUPS_STORAGE_KEY, value: JSON.stringify(loadedSetups.filter((setup) => !setup.builtIn)) },
          { key: "trading-journal-settings", value: JSON.stringify(loadedSettings) },
        ],
      })
      if (outcome === "hydrated") {
        // Unlock persistence only after load + migrate complete, so the initial
        // empty state never clobbers storage.
        setIsHydrated(true)
      } else if (outcome === "storage-error-readonly") {
        setStorageError(
          "Journal data could not be saved to local storage. The journal is open read-only: nothing will be persisted until storage is available again.",
        )
      }
    }
  }, [])

  // Save data to localStorage whenever it changes. No-ops until hydration and
  // in read-only future-schema mode, so the initial empty state can never
  // clobber stored data and future-schema data is never rewritten.
  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem("trading-journal-trades", JSON.stringify(trades))
  }, [trades, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem("trading-journal-settings", JSON.stringify(settings))
  }, [settings, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem("trading-journal-balance-adjustments", JSON.stringify(balanceAdjustments))
  }, [balanceAdjustments, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts))
  }, [accounts, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(SETUPS_STORAGE_KEY, JSON.stringify(setups.filter((setup) => !setup.builtIn)))
  }, [setups, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(ACCOUNT_SCOPE_KEY, JSON.stringify(selectedAccountScope))
  }, [selectedAccountScope, isHydrated])

  const addAccount = (account: Omit<TradingAccount, "id" | "createdAt">) => {
    if (!guardWrite("Creating accounts")) return
    const newAccount: TradingAccount = {
      ...account,
      id: createId(),
      createdAt: new Date().toISOString(),
    }
    setAccounts((prev) => [...prev, newAccount])
  }

  const updateAccount = (updatedAccount: TradingAccount) => {
    if (!guardWrite("Editing accounts")) return
    setAccounts((prev) => prev.map((account) => (account.id === updatedAccount.id ? updatedAccount : account)))
  }

  const deleteAccount = (id: string) => {
    if (!guardWrite("Deleting accounts")) return
    // Accounts that hold financial records cannot be deleted: trades are the
    // journal's core data and balance adjustments are financial records. Move
    // or remove that data first. Conservative block beats cascading deletes.
    const tradeCount = accountHasTrades(id, trades)
    const adjustmentCount = accountHasAdjustments(id, balanceAdjustments)
    if (tradeCount > 0 || adjustmentCount > 0) {
      const reasons: string[] = []
      if (tradeCount > 0) reasons.push(`${tradeCount} trade${tradeCount === 1 ? "" : "s"}`)
      if (adjustmentCount > 0) {
        reasons.push(`${adjustmentCount} balance adjustment${adjustmentCount === 1 ? "" : "s"}`)
      }
      window.alert(`This account cannot be deleted because it still contains ${reasons.join(" and ")}. Remove or reassign that data first.`)
      return
    }
    // Never allow deleting the last remaining account: the journal needs at
    // least one account to remain functional.
    if (accounts.filter((account) => account.id !== id).length === 0) {
      window.alert("You cannot delete the last remaining account.")
      return
    }
    setAccounts((prev) => prev.filter((account) => account.id !== id))
    setSelectedAccountScope((prev) =>
      prev.kind === "selected"
        ? (() => {
            const accountIds = prev.accountIds.filter((accountId) => accountId !== id)
            // A selected scope with nothing left is equivalent to All Accounts.
            return accountIds.length === 0 ? { kind: "all" } : { kind: "selected", accountIds }
          })()
        : prev,
    )
  }

  const addTrade = (tradeData: Omit<Trade, "id">) => {
    if (!guardWrite("Adding trades")) return
    const newTrade: Trade = {
      ...tradeData,
      id: Date.now().toString(),
    }
    setTrades((prev) => [newTrade, ...prev])
    setShowTradeForm(false)
  }

  const updateTrade = (updatedTrade: Trade) => {
    if (!guardWrite("Editing trades")) return
    setTrades((prev) => prev.map((trade) => (trade.id === updatedTrade.id ? updatedTrade : trade)))
  }

  const deleteTrade = (id: string) => {
    if (!guardWrite("Deleting trades")) return
    setTrades((prev) => prev.filter((trade) => trade.id !== id))
  }

  const handleRemoveAllTrades = () => {
    if (!guardWrite("Removing all trades")) return
    if (window.confirm("Remove ALL trades? This cannot be undone.")) {
      setTrades([])
    }
  }

  const handleBulkUpdate = (tradeIds: string[], updates: Partial<Trade>) => {
    if (!guardWrite("Bulk updating trades")) return
    setTrades((prev) =>
      prev.map((trade) => {
        if (!tradeIds.includes(trade.id)) return trade

        let updatedTrade = { ...trade }

        // Apply field updates
        if (updates.system) updatedTrade.system = updates.system
        if (updates.timeframe) updatedTrade.timeframe = updates.timeframe
        if (updates.grade) updatedTrade.grade = updates.grade
        if (updates.idealRiskAmount) updatedTrade.idealRiskAmount = updates.idealRiskAmount

        // Handle tag updates
        if (updates.addTags && updates.addTags.length > 0) {
          const newTags = [...new Set([...updatedTrade.tags, ...updates.addTags])]
          updatedTrade.tags = newTags
        }
        if (updates.removeTags && updates.removeTags.length > 0) {
          updatedTrade.tags = updatedTrade.tags.filter((tag) => !updates.removeTags!.includes(tag))
        }

        // Recalculate metrics if requested
        if (updates.recalculateMetrics) {
          updatedTrade = recalculateTradeMetrics(updatedTrade, settings)
        }

        return updatedTrade
      }),
    )
  }

  const handleImportTrades = (importedTrades: Omit<Trade, "id">[], duplicates?: string[]) => {
    if (!guardWrite("Importing trades")) return
    const newTrades = importedTrades.map(trade => ({
      ...trade,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
    }))

    if (duplicates && duplicates.length > 0) {
      alert(`${duplicates.length} duplicate trades were skipped based on ticket numbers.`)
    }

    setTrades((prev) => [...newTrades, ...prev])
    setShowImportDialog(false)
  }

  const handleImportData = (data: any) => {
    if (!guardWrite("Importing data")) return
    if (data.trades) {
      handleImportTrades(data.trades)
    }
    if (data.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings })
    }
    if (data.balanceAdjustments) {
      setBalanceAdjustments(data.balanceAdjustments)
    }
    setShowImportDialog(false)
  }

  const exportAllData = () => {
    const backup = buildFullBackup({
      accounts,
      setups,
      trades,
      balanceAdjustments,
      settings,
      accountScope: selectedAccountScope,
    })
    downloadFile(
      serializeFullBackup(backup),
      `trading-journal-backup-${new Date().toISOString().split("T")[0]}.json`,
      "application/json",
    )
  }

  /**
   * Restore a versioned full backup. Everything is validated BEFORE any state
   * is touched; on any validation error nothing changes (atomic abort). On
   * success the whole journal is replaced in one batched state update, keeping
   * the backup's stable ids.
   */
  const handleRestoreBackup = (text: string): RestoreResult => {
    if (!guardWrite("Restoring a backup")) {
      return { ok: false, message: "This journal is open read-only. A full restore is disabled." }
    }
    const parsed = parseBackup(text)
    if (parsed.kind === "invalid") {
      return { ok: false, message: parsed.message }
    }
    if (parsed.kind === "legacy") {
      return {
        ok: false,
        message: "This is a legacy trade export, not a full journal backup. Use the trade import flow instead.",
      }
    }
    const validation = validateBackup(parsed.backup)
    if (!validation.ok) {
      return { ok: false, message: `This backup cannot be restored:\n${validation.errors.join("\n")}` }
    }
    if (!window.confirm(
      "Restoring this backup will REPLACE all current trades, accounts, balance adjustments, setups, and settings. This cannot be undone. Continue?",
    )) {
      return { ok: false, message: "Restore cancelled." }
    }
    try {
      applyBackup(parsed.backup)
      setShowImportDialog(false)
      return { ok: true, message: "Backup restored successfully." }
    } catch (error) {
      console.error("Error applying backup:", error)
      return {
        ok: false,
        message: `The backup was valid but could not be applied (${error instanceof Error ? error.message : String(error)}). Nothing was changed.`,
      }
    }
  }

  const applyBackup = (backup: FullBackup) => {
    setTrades(backup.trades)
    setAccounts(backup.accounts)
    setBalanceAdjustments(backup.balanceAdjustments)
    setSettings({ ...DEFAULT_SETTINGS, ...backup.settings })
    setSetups(mergeSetups(backup.setups))
    setSelectedAccountScope(normalizeRestoredScope(backup.accountScope, backup.accounts))
  }

  const addBalanceAdjustment = (adjustment: Omit<BalanceAdjustment, "id">) => {
    if (!guardWrite("Adding balance adjustments")) return
    const newAdjustment: BalanceAdjustment = {
      ...adjustment,
      id: Date.now().toString(),
    }
    setBalanceAdjustments((prev) => [newAdjustment, ...prev])
    setShowBalanceAdjuster(false)
  }

  const deleteBalanceAdjustment = (id: string) => {
    if (!guardWrite("Deleting balance adjustments")) return
    setBalanceAdjustments((prev) => prev.filter((adj) => adj.id !== id))
  }

  const calculateStats = (tradeList: Trade[]): TradeStats => {
    if (tradeList.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0,
        averageR: 0,
        averageExpectedR: 0,
        expectedValue: 0,
        profitFactor: 0,
        expectancy: 0,
        expectedExpectancy: 0,
        totalR: 0,
        totalExpectedR: 0,
        winningTrades: 0,
        losingTrades: 0,
        largestWin: 0,
        largestLoss: 0,
        totalFees: 0,
        totalRisk: 0,
        totalIdealRisk: 0,
        overRiskedTrades: 0,
        underRiskedTrades: 0,
        avgRiskDeviation: 0,
      }
    }

    const totalTrades = tradeList.length
    const winningTrades = tradeList.filter((t) => t.pnl > 0).length // Count winning trades based on net P&L
    const losingTrades = tradeList.filter((t) => t.pnl < 0).length // Count losing trades based on net P&L
    const winRate = (winningTrades / totalTrades) * 100

    const totalNetPnL = tradeList.reduce((sum, t) => sum + t.pnl, 0) // pnl field contains net P&L
    const totalFees = tradeList.reduce((sum, t) => sum + t.fee, 0)
    const totalGrossPnL = totalNetPnL + totalFees // Calculate gross P&L for fee analysis
    const totalR = tradeList.reduce((sum, t) => sum + t.rMultiple, 0)
    const totalExpectedR = tradeList.reduce((sum, t) => sum + (t.expectedR || 0), 0) // Sum of expected R values
    
    const totalRisk = tradeList.reduce((sum, t) => sum + t.riskAmount, 0)
    const totalIdealRisk = tradeList.reduce((sum, t) => sum + (t.idealRiskAmount || 0), 0)

    const averageR = totalR / totalTrades
    const averageExpectedR = totalExpectedR / totalTrades
    const expectedValue = averageExpectedR // Expected Value is the average Expected R

    const grossProfit = tradeList.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0)
    const grossLoss = Math.abs(tradeList.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0))
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0

    const expectancy = totalNetPnL / totalTrades // Expectancy is average net P&L per trade
    const expectedExpectancy = averageExpectedR

    const largestWin = Math.max(...tradeList.map((t) => t.pnl), 0)
    const largestLoss = Math.min(...tradeList.map((t) => t.pnl), 0)

    const overRiskedTrades = tradeList.filter((t) => t.isOverRisked).length
    const underRiskedTrades = tradeList.filter((t) => t.isUnderRisked).length
    const avgRiskDeviation = tradeList.reduce((sum, t) => sum + (t.riskDeviation || 0), 0) / totalTrades

    return {
      totalTrades,
      winRate,
      totalPnL: totalNetPnL, // Net P&L for account balance calculations
      averageR,
      averageExpectedR,
      expectedValue,
      profitFactor,
      expectancy, // Average net P&L per trade
      expectedExpectancy,
      totalR,
      totalExpectedR,
      winningTrades,
      losingTrades,
      largestWin,
      largestLoss,
      totalFees,
      totalRisk,
      totalIdealRisk,
      overRiskedTrades,
      underRiskedTrades,
      avgRiskDeviation,
    }
  }

  // Account-scope derived data: every analytics surface consumes the scoped
  // subset so All Accounts and per-account views stay consistent.
  const scopedTrades = filterTradesByScope(trades, selectedAccountScope)
  const scopedAdjustments = filterAdjustmentsByScope(balanceAdjustments, selectedAccountScope)
  const scopedAccounts = scopeAccounts(selectedAccountScope, accounts)

  const stats = calculateStats(scopedTrades)

  // Scope-aware starting balance for the balance-growth chart. Single account →
  // that account's starting balance; All Accounts → sum of the scoped accounts'
  // starting balances; fallback to the settings value when no account is scoped.
  const scopedStartingBalance =
    scopedAccounts.length === 1
      ? scopedAccounts[0].startingBalance
      : scopedAccounts.length > 1
        ? scopedAccounts.reduce((sum, account) => sum + account.startingBalance, 0)
        : settings.accountBalance

  // Review queue: closed trades in scope that are not fully reviewed. Open
  // trades can never be reviewed, so they must not appear here.
  const needsReviewQueue = useMemo(
    () => sortClosedTradesByCloseDate(scopedTrades).filter((trade) => needsReview(trade)),
    [scopedTrades],
  )

  // P&L calendar points: reuse the account-aware daily series so single-account
  // and All Accounts (capital-weighted aggregate) behave exactly like the KPIs.
  const calendarPoints = useMemo<CalendarDayPoint[]>(() => {
    if (scopedAccounts.length === 1) {
      return toCalendarDayPoints(buildAccountDailySeries(scopedAccounts[0], trades, balanceAdjustments).points)
    }
    if (scopedAccounts.length > 1) {
      return toCalendarDayPoints(buildAggregateDailySeries(scopedAccounts, trades, balanceAdjustments).points)
    }
    const byDay = groupClosedTradesByCloseDate(scopedTrades)
    const fallback: CalendarDayPoint[] = []
    for (const [date, list] of byDay) {
      fallback.push({
        date,
        netPnl: list.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0),
        returnPct: null,
        adjustments: 0,
      })
    }
    return fallback.sort((a, b) => a.date.localeCompare(b.date))
  }, [scopedAccounts, scopedTrades, balanceAdjustments])

  // Review-only updates: merge the patch, never touch financial fields.
  const applyReviewPatch = (tradeId: string, patch: ReviewPatch) => {
    if (!guardWrite("Reviewing trades")) return
    setTrades((prev) => prev.map((trade) => (trade.id === tradeId ? applyReviewPatchToTrade(trade, patch) : trade)))
  }

  const handleSaveSettings = (nextSettings: SettingsType) => {
    if (!guardWrite("Changing settings")) return
    setSettings(nextSettings)
  }

  // Calculate adjusted account balance
  const netTradingPnL = calculateNetTradingPnL(trades) // stats.totalPnL contains net P&L
  const adjustedAccountBalance = calculateAdjustedAccountBalance(trades, settings, balanceAdjustments)

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Trading Journal</h1>
            <p className="text-muted-foreground">Track and analyze your trading performance</p>
          </div>          <div className="flex gap-2">
            <AccountSelector
              scope={selectedAccountScope}
              accounts={accounts}
              trades={trades}
              adjustments={balanceAdjustments}
              onScopeChange={setSelectedAccountScope}
              onManageAccounts={() => {
                if (guardWrite("Managing accounts")) setShowAccountManager(true)
              }}
            />
            <Button
              onClick={() => {
                if (guardWrite("Adding balance adjustments")) setShowBalanceAdjuster(true)
              }}
              variant="outline"
              className="gap-2"
              disabled={readOnly}
            >
              <DollarSign className="h-4 w-4" />
              Balance
            </Button>
            <Button
              onClick={() => {
                if (guardWrite("Importing trades")) setShowImportDialog(true)
              }}
              variant="outline"
              className="gap-2"
              disabled={readOnly}
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button onClick={exportAllData} variant="outline" className="gap-2 bg-transparent">
              <Download className="h-4 w-4" />
              Export All
            </Button>
            <Button onClick={handleRemoveAllTrades} variant="outline" className="gap-2 bg-transparent text-destructive hover:text-destructive" disabled={readOnly}>
              <Trash2 className="h-4 w-4" />
              Remove All
            </Button>
            <Button
              onClick={() => {
                if (guardWrite("Changing settings")) setShowSettings(true)
              }}
              variant="outline"
              size="icon"
              disabled={readOnly}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => {
                if (guardWrite("Adding trades")) setShowTradeForm(true)
              }}
              className="gap-2"
              disabled={readOnly}
            >
              <Plus className="h-4 w-4" />
              Add Trade
            </Button>
          </div>
        </div>

        {(schemaWarning || storageError) && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <strong>Read-only mode:</strong> {schemaWarning || storageError}
          </div>
        )}

        {/* Quantitative Performance Overview */}
        <QuantMetricsGrid
          trades={trades}
          settings={settings}
          accounts={accounts}
          scope={selectedAccountScope}
          balanceAdjustments={balanceAdjustments}
        />

        {/* Review queue: prominent but not intrusive, respects the account scope */}
        <ReviewQueue
          trades={scopedTrades}
          setups={setups}
          accounts={accounts}
          onReview={(trade) => {
            if (guardWrite("Reviewing trades")) setReviewTarget(trade)
          }}
          onView={(trade) => setDetailTarget(trade)}
        />

        {/* Main Content */}
        <Tabs defaultValue="trades" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-7">
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="systems">Systems</TabsTrigger>
            <TabsTrigger value="fee-analysis">Fee Analysis</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>

          <TabsContent value="trades">
            <TradesList
              trades={scopedTrades}
              onDeleteTrade={deleteTrade}
              onUpdateTrade={updateTrade}
              onBulkUpdate={handleBulkUpdate}
              settings={settings}
              accounts={accounts}
              setups={setups}
            />
          </TabsContent>

          <TabsContent value="dashboard">
            <AnalyticsDashboard
              trades={scopedTrades}
              stats={stats}
              settings={settings}
              startingBalance={scopedStartingBalance}
            />
          </TabsContent>

          <TabsContent value="advanced">
            <AdvancedAnalytics trades={scopedTrades} stats={stats} />
          </TabsContent>

          <TabsContent value="sessions">
            <SessionAnalytics trades={scopedTrades} settings={settings} />
          </TabsContent>

          <TabsContent value="systems">
            <SystemReports trades={scopedTrades} settings={settings} />
          </TabsContent>
          <TabsContent value="fee-analysis">
            <FeeAnalysis trades={scopedTrades} />
          </TabsContent>
          <TabsContent value="review" className="space-y-4">
            <SetupAnalytics trades={scopedTrades} setups={setups} />
            <GradeAnalytics trades={scopedTrades} />
            <ProcessMistakeAnalytics trades={scopedTrades} />
            <StopAdherence trades={scopedTrades} />
            <PnlCalendar
              points={calendarPoints}
              trades={scopedTrades}
              accounts={accounts}
              setups={setups}
              onView={(trade) => setDetailTarget(trade)}
            />
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        {showTradeForm && (
          <TradeEntryForm
            onSubmit={addTrade}
            onCancel={() => setShowTradeForm(false)}
            settings={settings}
            accounts={accounts}
            defaultAccountId={
              selectedAccountScope.kind === "selected" && selectedAccountScope.accountIds.length === 1
                ? selectedAccountScope.accountIds[0]
                : accounts.length > 0
                  ? accounts[0].id
                  : undefined
            }
          />
        )}

        {showImportDialog && (
          <ImportDialog
            onImport={handleImportTrades}
            onRestoreBackup={handleRestoreBackup}
            onCancel={() => setShowImportDialog(false)}
            settings={settings}
            existingTrades={trades}
            accounts={accounts}
            defaultAccountId={
              selectedAccountScope.kind === "selected" && selectedAccountScope.accountIds.length === 1
                ? selectedAccountScope.accountIds[0]
                : accounts.length > 0
                  ? accounts[0].id
                  : undefined
            }
          />
        )}

        {showSettings && (
          <SettingsPanel settings={settings} onSave={handleSaveSettings} onCancel={() => setShowSettings(false)} />
        )}

        {showBalanceAdjuster && (
          <BalanceAdjuster
            currentBalance={adjustedAccountBalance}
            adjustments={balanceAdjustments}
            accounts={accounts}
            defaultAccountId={
              selectedAccountScope.kind === "selected" && selectedAccountScope.accountIds.length === 1
                ? selectedAccountScope.accountIds[0]
                : accounts.length > 0
                  ? accounts[0].id
                  : undefined
            }
            onAddAdjustment={addBalanceAdjustment}
            onDeleteAdjustment={deleteBalanceAdjustment}
            onCancel={() => setShowBalanceAdjuster(false)}
          />
        )}

        {showAccountManager && (
          <AccountManager
            accounts={accounts}
            trades={trades}
            adjustments={balanceAdjustments}
            onAddAccount={addAccount}
            onUpdateAccount={updateAccount}
            onDeleteAccount={deleteAccount}
            onCancel={() => setShowAccountManager(false)}
          />
        )}

        {/* Review dialogs */}
        <QuickReviewDialog
          open={!!reviewTarget}
          trade={reviewTarget}
          queue={needsReviewQueue}
          setups={setups}
          accounts={accounts}
          onApplyPatch={applyReviewPatch}
          onOpenTrade={setReviewTarget}
          onClose={() => setReviewTarget(null)}
        />
        <TradeDetailDialog
          open={!!detailTarget}
          trade={detailTarget}
          setups={setups}
          accounts={accounts}
          onClose={() => setDetailTarget(null)}
        />
      </div>
    </div>
  )
}
