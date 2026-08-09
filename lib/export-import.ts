import type { AccountScope, TradingAccount } from "@/types/account"
import type { Settings, Trade, BalanceAdjustment } from "@/types/trade"
import type { Setup } from "../types/setup.ts"
import { DEFAULT_SETUPS } from "../types/setup.ts"
import { CURRENT_SCHEMA_VERSION } from "../utils/account-migration.ts"
import { getAccountName } from "../utils/account-analytics.ts"
import { getSetupName } from "../utils/setups.ts"
import { getReviewStatusLabel } from "../utils/trade-review.ts"
import { APP_CONFIG } from "./constants.ts"

/**
 * Export formats (documented contract):
 * - JSON exports are FULL-FIDELITY, VERSIONED BACKUPS. They carry every entity
 *   (accounts, setups, trades, balance adjustments, settings, account scope)
 *   with their STABLE ids and can be restored wholesale.
 * - CSV exports are TABULAR / ANALYSIS snapshots. They are human-readable and
 *   spreadsheet-friendly but are NOT a restore path: they carry no schema
 *   version, no stable entity graph, and there is no CSV restore system.
 */

export interface ExportData {
  trades: Trade[]
  settings: Settings
  balanceAdjustments: BalanceAdjustment[]
  exportDate: string
  version: string
}

export function exportToJSON(
  trades: Trade[],
  settings: Settings,
  balanceAdjustments: BalanceAdjustment[]
): string {
  const exportData: ExportData = {
    trades,
    settings,
    balanceAdjustments,
    exportDate: new Date().toISOString(),
    version: '1.0.0',
  }
  
  return JSON.stringify(exportData, null, 2)
}

// ============================================================ FULL BACKUP

export const BACKUP_KIND = "trading-journal-backup" as const

/**
 * Versioned, full-fidelity journal backup.
 *
 * Every id is preserved verbatim: `account.id`, `trade.accountId`,
 * `setup.id`, `trade.setupId`, review metadata and stop metadata. Restore
 * validates the WHOLE payload before touching state, so there are no dangling
 * references and no freshly minted ids unless the data genuinely requires it.
 *
 * `schemaVersion` is the journal DATA schema version at export time
 * (`CURRENT_SCHEMA_VERSION`). A backup whose schemaVersion is greater than the
 * current app's version was written by a newer build and MUST NOT be restored
 * into this one.
 */
export interface FullBackup {
  kind: typeof BACKUP_KIND
  schemaVersion: number
  exportedAt: string
  appVersion: string
  accounts: TradingAccount[]
  setups: Setup[]
  trades: Trade[]
  balanceAdjustments: BalanceAdjustment[]
  settings: Settings
  accountScope: AccountScope
}

export interface FullBackupInput {
  accounts: TradingAccount[]
  setups: Setup[]
  trades: Trade[]
  balanceAdjustments: BalanceAdjustment[]
  settings: Settings
  accountScope: AccountScope
}

export function buildFullBackup(input: FullBackupInput): FullBackup {
  return {
    kind: BACKUP_KIND,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    accounts: input.accounts,
    setups: input.setups,
    trades: input.trades,
    balanceAdjustments: input.balanceAdjustments,
    settings: input.settings,
    accountScope: input.accountScope,
  }
}

export function serializeFullBackup(backup: FullBackup): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * Parse and classify a JSON text:
 * - `full`: a versioned `trading-journal-backup` (restore path);
 * - `legacy`: a trade-only export (array of trades, or `{ trades: [...] }`) —
 *   this keeps the existing trade-import behavior;
 * - `invalid`: unparseable or unrecognized.
 *
 * Parsing NEVER mutates anything; destructive decisions happen only after
 * `validateBackup` confirms the whole payload.
 */
export function parseBackup(text: string): BackupParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: "invalid", message: "The file is not valid JSON." }
  }

  if (parsed && typeof parsed === "object" && (parsed as { kind?: unknown }).kind === BACKUP_KIND) {
    return { kind: "full", backup: parsed as FullBackup }
  }

  if (Array.isArray(parsed)) {
    return { kind: "legacy", message: "Legacy trade array export (no full-journal restore)." }
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { trades?: unknown }).trades)) {
    return { kind: "legacy", message: "Legacy trade export (no full-journal restore)." }
  }

  return { kind: "invalid", message: "Unrecognized JSON format. Expected a full journal backup or a trade export." }
}

export type BackupParseResult =
  | { kind: "full"; backup: FullBackup }
  | { kind: "legacy"; message: string }
  | { kind: "invalid"; message: string }

export interface BackupValidation {
  ok: boolean
  errors: string[]
}

export interface RestoreResult {
  ok: boolean
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/**
 * Validate the ENTIRE backup before anything touches React state or storage.
 * Accumulates every problem found so a restore either passes wholesale or is
 * rejected atomically — a partial restore is never possible.
 */
export function validateBackup(value: unknown): BackupValidation {
  const errors: string[] = []

  if (!isRecord(value)) {
    return { ok: false, errors: ["Backup is not an object."] }
  }
  if (value.kind !== BACKUP_KIND) {
    errors.push("Not a trading-journal backup.")
  }
  if (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion)) {
    errors.push("Backup is missing a valid numeric schemaVersion.")
  } else if (value.schemaVersion > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Backup schema v${value.schemaVersion} is newer than this app supports (v${CURRENT_SCHEMA_VERSION}). Refusing to restore to avoid destructive downgrade.`,
    )
  }
  if (!isNonEmptyString(value.exportedAt)) {
    errors.push("Backup is missing exportedAt.")
  }

  // --- accounts ---------------------------------------------------------
  const accountIds = new Set<string>()
  if (!Array.isArray(value.accounts)) {
    errors.push("Backup is missing the accounts array.")
  } else {
    for (const account of value.accounts) {
      if (!isRecord(account)) {
        errors.push("An account entry is not an object.")
        continue
      }
      if (!isNonEmptyString(account.id)) {
        errors.push("An account is missing a valid id.")
      } else if (accountIds.has(account.id)) {
        errors.push(`Duplicate account id: ${account.id}.`)
      } else {
        accountIds.add(account.id)
      }
      if (!isNonEmptyString(account.name)) errors.push(`Account ${String(account.id)} is missing a name.`)
      if (!isFiniteNumber(account.startingBalance)) {
        errors.push(`Account ${String(account.id)} has an invalid startingBalance.`)
      }
    }
  }

  // --- setups -----------------------------------------------------------
  // The backup may legitimately contain the built-in setups (they are part of
  // the app state), so duplicate detection is LOCAL to the backup array; the
  // known-id set is the union of built-ins and the backup's setups.
  const setupIds = new Set(DEFAULT_SETUPS.map((setup) => setup.id))
  const seenBackupSetupIds = new Set<string>()
  if (!Array.isArray(value.setups)) {
    errors.push("Backup is missing the setups array.")
  } else {
    for (const setup of value.setups) {
      if (!isRecord(setup)) {
        errors.push("A setup entry is not an object.")
        continue
      }
      if (!isNonEmptyString(setup.id) || !isNonEmptyString(setup.name)) {
        errors.push("A setup is missing a valid id or name.")
        continue
      }
      if (seenBackupSetupIds.has(setup.id)) {
        errors.push(`Duplicate setup id in backup: ${setup.id}.`)
      } else {
        seenBackupSetupIds.add(setup.id)
        setupIds.add(setup.id)
      }
    }
  }

  // --- trades -----------------------------------------------------------
  const tradeIds = new Set<string>()
  if (!Array.isArray(value.trades)) {
    errors.push("Backup is missing the trades array.")
  } else {
    for (const trade of value.trades) {
      if (!isRecord(trade)) {
        errors.push("A trade entry is not an object.")
        continue
      }
      if (!isNonEmptyString(trade.id)) {
        errors.push("A trade is missing a valid id.")
      } else if (tradeIds.has(trade.id)) {
        errors.push(`Duplicate trade id: ${trade.id}.`)
      } else {
        tradeIds.add(trade.id)
      }
      const accountId = trade.accountId
      if (accountId !== undefined && accountId !== null && !accountIds.has(accountId as string)) {
        errors.push(`Trade ${String(trade.id)} references missing account ${String(accountId)}.`)
      }
      const setupId = trade.setupId
      if (setupId !== undefined && setupId !== null && !setupIds.has(setupId as string)) {
        errors.push(`Trade ${String(trade.id)} references missing setup ${String(setupId)}.`)
      }
    }
  }

  // --- balance adjustments ----------------------------------------------
  if (!Array.isArray(value.balanceAdjustments)) {
    errors.push("Backup is missing the balanceAdjustments array.")
  } else {
    for (const adjustment of value.balanceAdjustments) {
      if (!isRecord(adjustment)) {
        errors.push("A balance adjustment entry is not an object.")
        continue
      }
      if (!isNonEmptyString(adjustment.id)) {
        errors.push("A balance adjustment is missing a valid id.")
      }
      if (!isFiniteNumber(adjustment.amount)) {
        errors.push(`Adjustment ${String(adjustment.id)} has an invalid amount.`)
      }
      const accountId = adjustment.accountId
      if (accountId !== undefined && accountId !== null && !accountIds.has(accountId as string)) {
        errors.push(`Adjustment ${String(adjustment.id)} references missing account ${String(accountId)}.`)
      }
    }
  }

  // --- settings ---------------------------------------------------------
  if (!isRecord(value.settings)) {
    errors.push("Backup is missing settings.")
  } else if (!isFiniteNumber(value.settings.accountBalance)) {
    errors.push("Backup settings are missing a valid accountBalance.")
  }

  // --- account scope ----------------------------------------------------
  const scope = value.accountScope
  if (!isRecord(scope)) {
    errors.push("Backup is missing the account scope.")
  } else if (scope.kind === "selected") {
    if (!Array.isArray(scope.accountIds)) {
      errors.push("Selected account scope is missing accountIds.")
    } else {
      for (const accountId of scope.accountIds) {
        if (!accountIds.has(accountId as string)) {
          errors.push(`Account scope references missing account ${String(accountId)}.`)
        }
      }
    }
  } else if (scope.kind !== "all") {
    errors.push("Account scope has an unknown kind.")
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Normalize a validated backup's scope for restore. An empty selected scope is
 * equivalent to "All Accounts"; unknown ids are dropped defensively (validation
 * already rejects them, so this is belt-and-braces).
 */
export function normalizeRestoredScope(scope: AccountScope, accounts: TradingAccount[]): AccountScope {
  if (scope.kind === "selected") {
    const validIds = scope.accountIds.filter((id) => accounts.some((account) => account.id === id))
    return validIds.length > 0 ? { kind: "selected", accountIds: validIds } : { kind: "all" }
  }
  return { kind: "all" }
}

// ============================================================ CSV (analysis)

/**
 * Tabular, spreadsheet-friendly snapshot. JSON is the backup format; CSV is
 * for analysis/external tools and has NO restore path.
 */
export function exportToCSV(trades: Trade[], accounts: TradingAccount[] = [], setups: Setup[] = []): string {
  if (trades.length === 0) {
    return ''
  }
  
  const headers = [
    'Date',
    'Time',
    'Account Name',
    'Asset',
    'Trade Type',
    'Entry Price',
    'Exit Price',
    'Stop Loss',
    'Take Profit',
    'Position Size',
    'Risk %',
    'R Multiple',
    'Expected R',
    'P&L',
    'Fee',
    'Risk Amount',
    'Ideal Risk Amount',
    'Risk Deviation',
    'Duration',
    'System',
    'Timeframe',
    'Setup',
    'Manual Grade',
    'Process Status',
    'Review Status',
    'Planned Stop',
    'Stop Source',
    'Notes',
    'Tags',
    'Outcome',
    'Grade',
    'Ticket',
    'Session',
    'Day of Week',
  ]

  const rows = trades.map(trade => [
    trade.date,
    trade.time,
    `"${getAccountName(accounts, trade.accountId).replace(/"/g, '""')}"`,
    trade.asset,
    trade.tradeType,
    trade.entryPrice,
    trade.exitPrice,
    trade.stopLoss,
    trade.takeProfit,
    trade.positionSize,
    trade.riskPercent,
    trade.rMultiple,
    trade.expectedR || 0,
    trade.pnl,
    trade.fee || 0,
    trade.riskAmount || 0,
    trade.idealRiskAmount || 0,
    trade.riskDeviation || 0,
    trade.duration,
    trade.system,
    trade.timeframe,
    `"${(getSetupName(setups, trade.setupId) || "").replace(/"/g, '""')}"`,
    `"${(trade.manualSetupGrade || "").replace(/"/g, '""')}"`,
    `"${(trade.manualProcessFollowed === true ? "Followed" : trade.manualProcessFollowed === false ? "Violated" : "").replace(/"/g, '""')}"`,
    `"${getReviewStatusLabel(trade).replace(/"/g, '""')}"`,
    trade.plannedStopPrice !== undefined && trade.plannedStopPrice !== null ? trade.plannedStopPrice : "",
    `"${(trade.stopSource || "").replace(/"/g, '""')}"`,
    `"${trade.notes.replace(/"/g, '""')}"`, // Escape quotes in notes
    `"${trade.tags.join(', ')}"`,
    trade.outcome,
    trade.grade,
    trade.ticket || '',
    trade.session,
    trade.dayOfWeek,
  ])
  
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadJSONExport(
  trades: Trade[],
  settings: Settings,
  balanceAdjustments: BalanceAdjustment[]
): void {
  const content = exportToJSON(trades, settings, balanceAdjustments)
  const filename = `trading-journal-export-${new Date().toISOString().split('T')[0]}.json`
  downloadFile(content, filename, 'application/json')
}

export function downloadCSVExport(
  trades: Trade[],
  accounts: TradingAccount[] = [],
  setups: Setup[] = []
): void {
  const content = exportToCSV(trades, accounts, setups)
  const filename = `trading-journal-trades-${new Date().toISOString().split('T')[0]}.csv`
  downloadFile(content, filename, 'text/csv')
}

export function validateFileSize(file: File): boolean {
  return file.size <= APP_CONFIG.FILE_UPLOAD.MAX_FILE_SIZE
}

export function validateFileType(file: File): boolean {
  return (APP_CONFIG.FILE_UPLOAD.ALLOWED_TYPES as readonly string[]).includes(file.type)
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
