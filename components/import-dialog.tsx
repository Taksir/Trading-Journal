"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { X, Upload, FileText, Download, AlertTriangle, Info } from "lucide-react"
import type { Trade, Settings, BrokerTrade } from "@/types/trade"
import { getTradingSession, getDayOfWeek, DEFAULT_TRADING_SESSIONS } from "@/utils/trading-sessions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { parseFidelityCsv } from "@/lib/fidelity-parser"
import { convertFidelityRoundTripToTrade } from "@/lib/fidelity-to-trade"
import type { TradingAccount } from "@/types/account"
import { detectDuplicates } from "@/utils/import-dedupe"
import { applyStopInfo } from "@/utils/trade-review"
import { createId } from "@/utils/ids"
import { validateNewAccountSpec, type ImportDestination, type ImportPayload } from "@/utils/import-account"

interface ImportDialogProps {
  onImport: (payload: ImportPayload) => void
  onRestoreBackup?: (backupText: string) => { ok: boolean; message: string }
  onCancel: () => void
  settings: Settings
  existingTrades: Trade[]
  accounts?: TradingAccount[]
  defaultAccountId?: string
}

const BROKER_LABEL: Record<"exness" | "fidelity", string> = {
  fidelity: "Fidelity",
  exness: "Exness",
}

export function ImportDialog({
  onImport,
  onRestoreBackup,
  onCancel,
  settings,
  existingTrades,
  accounts = [],
  defaultAccountId,
}: ImportDialogProps) {
  const [csvData, setCsvData] = useState("")
  const [jsonData, setJsonData] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewTrades, setPreviewTrades] = useState<Omit<Trade, "id">[]>([])
  const [duplicates, setDuplicates] = useState<string[]>([])
  const [broker, setBroker] = useState<"exness" | "fidelity">("fidelity")
  const [fidelityWarnings, setFidelityWarnings] = useState<string[]>([])
  const [conflictCount, setConflictCount] = useState(0)

  // Destination account: "Create New Account" is the default so a fresh
  // brokerage CSV is never silently merged into Default Account.
  const [destinationMode, setDestinationMode] = useState<"new" | "existing">("new")
  const [accountId, setAccountId] = useState<string>(defaultAccountId || (accounts.length > 0 ? accounts[0].id : ""))
  const [newAccountName, setNewAccountName] = useState("")
  const [newAccountBalance, setNewAccountBalance] = useState("")
  const [newAccountBroker, setNewAccountBroker] = useState(BROKER_LABEL.fidelity)
  // The accountId used by the CURRENT preview (a freshly generated id for a new
  // account, or the selected existing account). Stored so dedupe, the summary
  // and the final import all agree on one destination.
  const [stagedAccountId, setStagedAccountId] = useState("")
  const [detectedCount, setDetectedCount] = useState(0)

  const newAccountSpec = {
    name: newAccountName,
    broker: newAccountBroker,
    startingBalance: Number(newAccountBalance.trim() === "" ? NaN : newAccountBalance),
    currency: "USD",
  }
  const newAccountValidationError = destinationMode === "new" ? validateNewAccountSpec(newAccountSpec) : null

  const clearPreview = () => {
    setPreviewTrades([])
    setDuplicates([])
    setConflictCount(0)
    setStagedAccountId("")
    setDetectedCount(0)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, type: "csv" | "json") => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        if (type === "csv") {
          setCsvData(text)
        } else {
          setJsonData(text)
        }
      }
      reader.readAsText(file)
    }
  }

  const parseBrokerCSV = (csvText: string): BrokerTrade[] => {
    try {
      const lines = csvText.trim().split("\n")
      if (lines.length < 2) {
        throw new Error("CSV must have at least a header row and one data row")
      }

      const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""))

      return lines.slice(1).map((line, index) => {
        const values = line.split(",").map((v) => v.trim().replace(/"/g, ""))
        const trade: any = {}

        headers.forEach((header, index) => {
          trade[header] = values[index] || ""
        })

        return trade as BrokerTrade
      })
    } catch (error) {
      console.error("Error parsing CSV:", error)
      throw error
    }
  }

  const convertBrokerTradeToTrade = (brokerTrade: BrokerTrade): Omit<Trade, "id"> => {
    try {
      const openingDate = new Date(brokerTrade.opening_time_utc)
      const closingDate = new Date(brokerTrade.closing_time_utc)

      if (isNaN(openingDate.getTime()) || isNaN(closingDate.getTime())) {
        throw new Error(`Invalid date format in trade ${brokerTrade.ticket}`)
      }

      // Extract asset name (remove USD suffix)
      const asset = brokerTrade.symbol.replace(/USD$|USDT$/, "")

      // Calculate duration
      const durationMs = closingDate.getTime() - openingDate.getTime()
      const totalSeconds = Math.floor(durationMs / 1000)
      const days = Math.floor(totalSeconds / (24 * 60 * 60))
      const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60))
      const minutes = Math.floor((totalSeconds % (60 * 60)) / 60)
      const seconds = totalSeconds % 60

      // Format duration string
      let duration = ""
      if (days > 0) duration += `${days}d `
      if (hours > 0) duration += `${hours}h `
      if (minutes > 0) duration += `${minutes}m `
      if (seconds > 0 || duration === "") duration += `${seconds}s`
      duration = duration.trim()

      // Get date and time in UTC - extract directly from the original UTC string
      const date = brokerTrade.opening_time_utc.split("T")[0]
      const time = openingDate.toTimeString().slice(0, 5)

      // Get End date and time in UTC - extract directly from the original UTC string
      const endDate = brokerTrade.closing_time_utc.split("T")[0]
      const endTime = closingDate.toTimeString().slice(0, 5)

      // Detect trading session and day of week
      const tradingSessions =
        settings?.tradingSessions && Array.isArray(settings.tradingSessions) && settings.tradingSessions.length > 0
          ? settings.tradingSessions
          : DEFAULT_TRADING_SESSIONS
      const session = getTradingSession(time, tradingSessions)
      const dayOfWeek = getDayOfWeek(date)

      // Risk from the broker data itself (Exness exports stop_loss/lots). We do
      // NOT fabricate an ideal risk or an ideal stop during import.
      const entryPrice = Number(brokerTrade.opening_price)
      const stopLoss = Number(brokerTrade.stop_loss)
      const positionSize = Number(brokerTrade.lots)

      if (isNaN(entryPrice) || isNaN(stopLoss) || isNaN(positionSize)) {
        throw new Error(`Invalid numeric values in trade ${brokerTrade.ticket}`)
      }

      const riskPerUnit = Math.abs(entryPrice - stopLoss)
      const riskAmount = riskPerUnit * positionSize

      // Calculate fee
      const assetKey = asset.toUpperCase()
      const feeRate = settings?.assetFees?.[assetKey] || 0
      const fee = Math.abs(Number(brokerTrade.commission_usd)) || positionSize * feeRate

      // Calculate actual risk including fees
      const actualRiskAmount = riskAmount + fee

      // Calculate P&L and R-multiple
      const grossPnL = Number(brokerTrade.profit_usd) // profit_usd is the gross profit (before fees)
      const netPnL = grossPnL - fee // Calculate net profit: Gross - Fee gives net profit
      const pnl = netPnL // Store NET P&L in pnl field (what trader actually received)

      // R-multiple should be based on the original risk (without fees) for consistency
      const rMultiple = riskAmount > 0 ? netPnL / riskAmount : 0

      // No ideal risk is fabricated for imports; these stay "no data" (0).
      const idealRiskAmount = 0
      const expectedR = 0
      const riskDeviation = 0

      const isOverRisked = false
      const isUnderRisked = false

      // Calculate risk percentage
      const riskPercent = (settings?.accountBalance || 0) > 0 ? (actualRiskAmount / (settings?.accountBalance || 1)) * 100 : 0

      // Determine outcome
      let outcome: "Win" | "Loss" | "Breakeven" = "Breakeven"
      if (rMultiple > 0.1) outcome = "Win"
      else if (rMultiple < -0.1) outcome = "Loss"

      // Determine grade based on outcome and close reason
      let grade = "C"
      if (brokerTrade.close_reason === "tp") grade = "A"
      else if (brokerTrade.close_reason === "sl") grade = outcome === "Win" ? "B+" : "D"
      else grade = "C"

      const convertedTrade = {
        date,
        time,
        endDate,
        endTime,
        asset,
        tradeType: (brokerTrade.type === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice,
        exitPrice: Number(brokerTrade.closing_price),
        stopLoss,
        takeProfit: Number(brokerTrade.take_profit) || 0,
        positionSize,
        riskPercent: Number(riskPercent.toFixed(2)),
        rMultiple: Number(rMultiple.toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
        fee: Number(fee.toFixed(2)),
        riskAmount: Number(riskAmount.toFixed(2)),
        idealRiskAmount,
        actualRiskAmount: Number(actualRiskAmount.toFixed(2)),
        riskDeviation: Number(riskDeviation.toFixed(2)),
        expectedR: Number(expectedR.toFixed(2)),
        isOverRisked,
        isUnderRisked,
        duration,
        system: "Imported",
        timeframe: "",
        notes: `Imported from broker. Close reason: ${brokerTrade.close_reason}`,
        tags: ["Imported"],
        outcome,
        grade,
        ticket: brokerTrade.ticket,
        session: session.name,
        dayOfWeek,
      } as Omit<Trade, "id">

      return convertedTrade
    } catch (error) {
      console.error("Error converting broker trade:", error)
      throw error
    }
  }

  const checkForDuplicates = (
    newTrades: Omit<Trade, "id">[],
  ): { trades: Omit<Trade, "id">[]; duplicates: string[]; conflicts: number } => {
    const result = detectDuplicates(existingTrades, newTrades)
    const duplicateLabels = result.duplicates.map((trade) => trade.ticket || trade.asset || "unknown")
    return { trades: result.newTrades, duplicates: duplicateLabels, conflicts: result.conflicts.length }
  }

  // Stamp the destination accountId BEFORE duplicate detection so dedupe is
  // account-aware (same trade in a different account is NOT a duplicate).
  // applyStopInfo is the canonical trade-review stop logic (inferred stops for
  // closed losing trades without a manual stop); it never invents risk values.
  const stampAccount = (trades: Omit<Trade, "id">[], targetAccountId: string): Omit<Trade, "id">[] =>
    trades.map((trade) =>
      applyStopInfo({
        ...trade,
        accountId: targetAccountId,
      } as Omit<Trade, "id">),
    )

  // Resolve the destination accountId for the current preview. For a new
  // account this generates a fresh stable id and validates the name/balance
  // FIRST, so a malformed destination never produces a preview (and thus never
  // an account). Blocks with a message when no valid destination is chosen.
  const resolveTargetAccountId = (): string | null => {
    if (destinationMode === "new") {
      const error = validateNewAccountSpec(newAccountSpec)
      if (error) {
        alert(error)
        return null
      }
      return createId()
    }
    if (!accountId) {
      alert("Select an account to import into, or choose Create New Account.")
      return null
    }
    return accountId
  }

  const processExnessCSV = (targetAccountId: string) => {
    const brokerTrades = parseBrokerCSV(csvData)
    const convertedTrades = brokerTrades.map((trade, index) => {
      try {
        return convertBrokerTradeToTrade(trade)
      } catch (error) {
        console.error(`Error converting trade ${index + 1}:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Error converting trade ${index + 1}: ${errorMessage}`)
      }
    })

    const { trades: uniqueTrades, duplicates: foundDuplicates, conflicts } = checkForDuplicates(
      stampAccount(convertedTrades, targetAccountId),
    )

    setFidelityWarnings([])
    setStagedAccountId(targetAccountId)
    setDetectedCount(convertedTrades.length)
    setPreviewTrades(uniqueTrades)
    setDuplicates(foundDuplicates)
    setConflictCount(conflicts)
  }

  const processFidelityCSV = (targetAccountId: string) => {
    const result = parseFidelityCsv(csvData)

    const warnings: string[] = []
    if (result.skippedRows > 0) {
      warnings.push(
        `${result.skippedRows} non-trade row(s) (dividends, transfers, interest, etc.) were skipped.`
      )
    }
    if (result.optionRows > 0) {
      warnings.push(`${result.optionRows} option row(s) were skipped. Options import is not supported yet.`)
    }
    if (result.openPositions.length > 0) {
      warnings.push(
        `Open position(s) not imported (still held): ${result.openPositions
          .map((p) => `${p.shares} ${p.symbol}`)
          .join(", ")}`
      )
    }
    if (result.unmatchedSells.length > 0) {
      warnings.push(
        `Sell(s) with no matching buy were skipped: ${result.unmatchedSells
          .map((u) => `${u.shares} ${u.symbol}`)
          .join(", ")}`
      )
    }

    const convertedTrades = result.roundTrips.map((roundTrip) =>
      convertFidelityRoundTripToTrade(roundTrip, { settings })
    )

    const { trades: uniqueTrades, duplicates: foundDuplicates, conflicts } = checkForDuplicates(
      stampAccount(convertedTrades, targetAccountId),
    )

    setFidelityWarnings(warnings)
    setStagedAccountId(targetAccountId)
    setDetectedCount(convertedTrades.length)
    setPreviewTrades(uniqueTrades)
    setDuplicates(foundDuplicates)
    setConflictCount(conflicts)
  }

  const processCSV = () => {
    if (!csvData.trim()) return

    const targetAccountId = resolveTargetAccountId()
    if (!targetAccountId) return

    setIsProcessing(true)

    try {
      if (broker === "fidelity") {
        processFidelityCSV(targetAccountId)
      } else {
        processExnessCSV(targetAccountId)
      }
    } catch (error) {
      console.error("Error processing CSV:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      alert(`Error processing CSV: ${errorMessage}. Please check the format and try again.`)
    }

    setIsProcessing(false)
  }

  const processJSON = () => {
    if (!jsonData.trim()) return

    setIsProcessing(true)

    try {
      const parsedData = JSON.parse(jsonData)

      // Versioned full-journal backup: route to the validated restore flow,
      // which confirms the destructive replace and aborts atomically on any
      // validation failure. Legacy trade exports keep the import behavior.
      if (parsedData && typeof parsedData === "object" && parsedData.kind === "trading-journal-backup") {
        if (onRestoreBackup) {
          const result = onRestoreBackup(jsonData)
          alert(result.message)
          if (result.ok) {
            clearPreview()
            setJsonData("")
          }
          return
        }
        throw new Error("Full journal restore is not available in this build.")
      }

      let trades: Omit<Trade, "id">[] = []

      if (Array.isArray(parsedData)) {
        trades = parsedData
      } else if (parsedData.trades && Array.isArray(parsedData.trades)) {
        trades = parsedData.trades
      } else {
        throw new Error("Invalid JSON format")
      }

      const targetAccountId = resolveTargetAccountId()
      if (!targetAccountId) return

      const { trades: uniqueTrades, duplicates: foundDuplicates, conflicts } = checkForDuplicates(
        stampAccount(trades, targetAccountId),
      )
      setStagedAccountId(targetAccountId)
      setDetectedCount(trades.length)
      setPreviewTrades(uniqueTrades)
      setDuplicates(foundDuplicates)
      setConflictCount(conflicts)
    } catch (error) {
      console.error("Error processing JSON:", error)
      alert("Error processing JSON. Please check the format.")
    }

    setIsProcessing(false)
  }

  const handleImport = () => {
    if (previewTrades.length === 0 || !stagedAccountId) return
    if (destinationMode === "new" && newAccountValidationError) {
      alert(newAccountValidationError)
      return
    }

    const destination: ImportDestination =
      destinationMode === "new"
        ? { kind: "new", accountId: stagedAccountId, spec: newAccountSpec }
        : { kind: "existing", accountId: stagedAccountId }

    onImport({ trades: previewTrades, duplicates, destination })
  }

  const handleBrokerChange = (value: string) => {
    setBroker(value as "exness" | "fidelity")
    setNewAccountBroker(BROKER_LABEL[value as "exness" | "fidelity"])
    setFidelityWarnings([])
    clearPreview()
  }

  const handleAccountSelect = (value: string) => {
    if (value === "new") {
      setDestinationMode("new")
    } else {
      setDestinationMode("existing")
      setAccountId(value)
    }
    clearPreview()
  }

  const destinationName =
    destinationMode === "existing"
      ? accounts.find((a) => a.id === stagedAccountId)?.name || accounts.find((a) => a.id === accountId)?.name || ""
      : newAccountName.trim() || "New Account"

  const exportSampleJSON = () => {
    const sampleTrade = {
      date: "2025-01-01",
      time: "10:00",
      asset: "BTC",
      tradeType: "Long",
      entryPrice: 50000,
      exitPrice: 51000,
      stopLoss: 49500,
      takeProfit: 52000,
      positionSize: 0.1,
      riskPercent: 1.0,
      rMultiple: 1.0,
      pnl: 100,
      fee: 5,
      riskAmount: 50,
      idealRiskAmount: 100,
      actualRiskAmount: 55,
      riskDeviation: -45,
      expectedR: 1.0,
      isOverRisked: false,
      isUnderRisked: true,
      duration: "2h",
      system: "Breakout",
      timeframe: "1h",
      notes: "Sample trade",
      tags: ["Sample"],
      outcome: "Win",
      grade: "A",
      ticket: "12345",
      session: "London",
      dayOfWeek: "Monday",
    }

    const sampleData = {
      trades: [sampleTrade],
      settings: settings,
      exportDate: new Date().toISOString(),
    }

    const blob = new Blob([JSON.stringify(sampleData, null, 2)], { type: "application/json" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "trading-journal-sample.json"
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Import Trades</CardTitle>
              <CardDescription>Import trades from CSV or JSON files</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Account Destination — shared by CSV and legacy JSON imports */}
          <div>
            <Label htmlFor="import-account">Account</Label>
            <Select
              value={destinationMode === "existing" ? accountId : "new"}
              onValueChange={handleAccountSelect}
            >
              <SelectTrigger id="import-account" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Create New Account</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-1">
              Choose an existing account or create a new one, so this CSV is never silently merged into Default
              Account. Duplicate detection is account-aware: the same trade in a different account is not a
              duplicate.
            </p>
          </div>

          {/* New Account Fields */}
          {destinationMode === "new" && (
            <>
              <div>
                <Label htmlFor="new-account-name">Account Name</Label>
                <Input
                  id="new-account-name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g. Fidelity Main"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="new-account-balance">Starting Balance</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="new-account-balance"
                    type="number"
                    step="0.01"
                    min="0"
                    value={newAccountBalance}
                    onChange={(e) => setNewAccountBalance(e.target.value)}
                    placeholder="50000"
                    className="pl-7"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Account equity before the earliest imported trade. This is not counted as profit or a deposit.
                </p>
              </div>
              <div>
                <Label htmlFor="new-account-broker">Broker</Label>
                <Input
                  id="new-account-broker"
                  value={newAccountBroker}
                  onChange={(e) => setNewAccountBroker(e.target.value)}
                  className="mt-1"
                />
              </div>
            </>
          )}

          <Tabs defaultValue="csv" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="csv">CSV Import</TabsTrigger>
              <TabsTrigger value="json">JSON Import/Export</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-6">
              {/* Broker Selection */}
              <div>
                <Label htmlFor="broker">Broker</Label>
                <Select value={broker} onValueChange={handleBrokerChange}>
                  <SelectTrigger id="broker" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fidelity">Fidelity (Stocks/ETFs)</SelectItem>
                    <SelectItem value="exness">Exness.com (Forex/Crypto)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-1">
                  {broker === "fidelity"
                    ? "Fidelity: Accounts & Trade → Activity & Orders → History → Download (CSV). One row per order; buys and sells are paired into round trips."
                    : "Exness: broker statement export (opening_time_utc, lots, symbol, profit_usd, etc.)."}
                </p>
              </div>

              {/* File Upload */}
              <div>
                <Label htmlFor="csvFile">Upload CSV File</Label>
                <Input
                  id="csvFile"
                  type="file"
                  accept=".csv"
                  onChange={(e) => handleFileUpload(e, "csv")}
                  className="mt-1"
                />
              </div>

              {/* Manual CSV Input */}
              <div>
                <Label htmlFor="csvData">Or Paste CSV Data</Label>
                <Textarea
                  id="csvData"
                  placeholder="Paste your CSV data here..."
                  value={csvData}
                  onChange={(e) => setCsvData(e.target.value)}
                  rows={8}
                  className="mt-1 font-mono text-sm"
                />
              </div>

              {/* Process Button */}
              <div className="flex justify-center">
                <Button onClick={processCSV} disabled={!csvData.trim() || isProcessing} className="gap-2">
                  <FileText className="h-4 w-4" />
                  {isProcessing ? "Processing..." : "Process CSV"}
                </Button>
              </div>

              {/* Fidelity Warnings */}
              {fidelityWarnings.length > 0 && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-700 mt-0.5" />
                    <div>
                      <span className="font-medium text-blue-800">Import Notes</span>
                      <ul className="text-sm text-blue-700 mt-1 space-y-1">
                        {fidelityWarnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="json" className="space-y-6">
              {/* JSON Export/Import Instructions */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">JSON Import/Export</h4>
                <p className="text-sm text-blue-700 mb-3">
                  JSON is the full-fidelity backup format: "Export All" writes a versioned backup (accounts, setups,
                  trades, balance adjustments, settings, scope) that can be restored here to replace all current data.
                  Legacy trade-only JSON files are still imported as new trades into the selected account.
                </p>
                <Button onClick={exportSampleJSON} variant="outline" size="sm" className="gap-2 bg-transparent">
                  <Download className="h-4 w-4" />
                  Download Sample JSON
                </Button>
              </div>

              {/* File Upload */}
              <div>
                <Label htmlFor="jsonFile">Upload JSON File</Label>
                <Input
                  id="jsonFile"
                  type="file"
                  accept=".json"
                  onChange={(e) => handleFileUpload(e, "json")}
                  className="mt-1"
                />
              </div>

              {/* Manual JSON Input */}
              <div>
                <Label htmlFor="jsonData">Or Paste JSON Data</Label>
                <Textarea
                  id="jsonData"
                  placeholder="Paste your JSON data here..."
                  value={jsonData}
                  onChange={(e) => setJsonData(e.target.value)}
                  rows={8}
                  className="mt-1 font-mono text-sm"
                />
              </div>

              {/* Process Button */}
              <div className="flex justify-center">
                <Button onClick={processJSON} disabled={!jsonData.trim() || isProcessing} className="gap-2">
                  <FileText className="h-4 w-4" />
                  {isProcessing ? "Processing..." : "Process JSON"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Import Summary */}
          {(previewTrades.length > 0 || detectedCount > 0) && (
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold mb-3">Import Summary</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Broker</dt>
                <dd>{BROKER_LABEL[broker]}</dd>
                <dt className="text-muted-foreground">Destination</dt>
                <dd>
                  {destinationName}
                  {destinationMode === "new" && <span className="text-blue-600"> (New Account)</span>}
                </dd>
                {destinationMode === "new" && (
                  <>
                    <dt className="text-muted-foreground">Starting Balance</dt>
                    <dd>${Number.isFinite(newAccountSpec.startingBalance) ? newAccountSpec.startingBalance.toLocaleString() : "—"}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Trades detected</dt>
                <dd>{detectedCount}</dd>
                <dt className="text-muted-foreground">New</dt>
                <dd>{previewTrades.length}</dd>
                <dt className="text-muted-foreground">Duplicates skipped</dt>
                <dd>{duplicates.length}</dd>
              </dl>
            </div>
          )}

          {/* Duplicates Warning */}
          {duplicates.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800 mb-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Duplicate Trades Found</span>
              </div>
              <p className="text-sm text-yellow-700 mb-2">
                {duplicates.length} trades matching existing records (same account) were skipped:
              </p>
              <div className="flex flex-wrap gap-1">
                {duplicates.map((ticket, index) => (
                  <span key={`${ticket}-${index}`} className="text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded">
                    {ticket}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conflicts Warning */}
          {conflictCount > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-800 mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Conflicts Skipped</span>
              </div>
              <p className="text-sm text-red-700">
                {conflictCount} trade(s) matched an existing record but had different details and were skipped to
                protect your history.
              </p>
            </div>
          )}

          {/* Preview */}
          {previewTrades.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">
                Preview ({previewTrades.length} trades)
                {duplicates.length > 0 && (
                  <span className="text-yellow-600"> • {duplicates.length} duplicates skipped</span>
                )}
                {conflictCount > 0 && <span className="text-red-600"> • {conflictCount} conflicts skipped</span>}
              </h3>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Asset</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-right">Entry</th>
                      <th className="p-2 text-right">Exit</th>
                      <th className="p-2 text-right">P&L</th>
                      <th className="p-2 text-right">R</th>
                      <th className="p-2 text-left">Grade</th>
                      <th className="p-2 text-left">Ticket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewTrades.slice(0, 10).map((trade, index) => (
                      <tr key={index} className="border-t">
                        <td className="p-2">{trade.date}</td>
                        <td className="p-2">{trade.asset}</td>
                        <td className="p-2">{trade.tradeType}</td>
                        <td className="p-2 text-right">{trade.entryPrice}</td>
                        <td className="p-2 text-right">{trade.exitPrice}</td>
                        <td className={`p-2 text-right ${trade.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                          ${trade.pnl}
                        </td>
                        <td className={`p-2 text-right ${trade.rMultiple >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {trade.rMultiple}R
                        </td>
                        <td className="p-2">{trade.grade}</td>
                        <td className="p-2">{trade.ticket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewTrades.length > 10 && (
                  <p className="p-2 text-center text-muted-foreground">
                    ... and {previewTrades.length - 10} more trades
                  </p>
                )}
              </div>
            </div>
          )}

          {destinationMode === "new" && newAccountValidationError && (
            <p className="text-sm text-destructive">{newAccountValidationError}</p>
          )}

          {/* Import Actions */}
          <div className="flex gap-4 pt-4">
            <Button
              onClick={handleImport}
              disabled={previewTrades.length === 0 || !stagedAccountId || (destinationMode === "new" && !!newAccountValidationError)}
              className="flex-1 gap-2"
            >
              <Upload className="h-4 w-4" />
              Import {previewTrades.length} Trades
              {duplicates.length > 0 && <span>({duplicates.length} skipped)</span>}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
