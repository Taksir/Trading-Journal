"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import ReactMarkdown from "react-markdown"
import { ReviewDetails } from "./review-details"
import type { Setup } from "@/types/setup"
import type { TradingAccount } from "@/types/account"
import type { Trade } from "@/types/trade"
import { getAccountName } from "@/utils/account-analytics"

interface TradeDetailDialogProps {
  open: boolean
  trade: Trade | null
  setups?: Setup[]
  accounts?: TradingAccount[]
  onClose: () => void
}

/** Cleaner trade summary: symbol / account / result / setup / plan / execution /
 *  process / mistakes / thesis / review. Keeps the table itself scan-friendly. */
export function TradeDetailDialog({ open, trade, setups = [], accounts = [], onClose }: TradeDetailDialogProps) {
  if (!trade) return null

  const accountName = getAccountName(accounts, trade.accountId)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trade Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-auto max-h-[calc(100vh-350px)]">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold">Basic Info</h4>
              <p>
                <strong>Date:</strong> {trade.date} {trade.time}
              </p>
              <p>
                <strong>Asset:</strong> {trade.asset}
              </p>
              <p>
                <strong>Account:</strong> {accountName}
              </p>
              <p>
                <strong>Type:</strong> {trade.tradeType}
              </p>
              <p>
                <strong>System:</strong> {trade.system}
              </p>
              <p>
                <strong>Timeframe:</strong> {trade.timeframe}
              </p>
              <p>
                <strong>Session:</strong> {trade.session}
              </p>
              <p>
                <strong>Day:</strong> {trade.dayOfWeek}
              </p>
              <p>
                <strong>Duration:</strong> {trade.duration || "N/A"}
              </p>
            </div>
            <div>
              <h4 className="font-semibold">Performance</h4>
              <p>
                <strong>R-Multiple:</strong>{" "}
                <span className={trade.rMultiple >= 0 ? "text-green-600" : "text-red-600"}>{trade.rMultiple}R</span>
              </p>
              <p>
                <strong>Expected R:</strong>{" "}
                <span className={(trade.expectedR || 0) >= 0 ? "text-green-600" : "text-red-600"}>
                  {(trade.expectedR || 0).toFixed(2)}R
                </span>
              </p>
              <p>
                <strong>P&L (Net):</strong>{" "}
                <span className={trade.pnl >= 0 ? "text-green-600" : "text-red-600"}>${trade.pnl}</span>
              </p>
              <p>
                <strong>Fee:</strong> ${(trade.fee || 0).toFixed(2)}
              </p>
              <p>
                <strong>Execution Grade:</strong> {trade.grade}
              </p>
              <p>
                <strong>Outcome:</strong> <Badge variant={trade.outcome === "Win" ? "default" : trade.outcome === "Loss" ? "destructive" : "secondary"}>{trade.outcome}</Badge>
              </p>
              <p>
                <strong>Risk:</strong> {trade.riskPercent}%
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold">Price Levels</h4>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <p>
                <strong>Entry:</strong> {trade.entryPrice}
              </p>
              <p>
                <strong>Exit:</strong> {trade.exitPrice}
              </p>
              <p>
                <strong>Stop Loss:</strong> {trade.stopLoss}
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold">Risk Management</h4>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <p>
                <strong>Ideal Risk:</strong> ${trade.idealRiskAmount || 0}
              </p>
              <p>
                <strong>Actual Risk:</strong> ${trade.actualRiskAmount || trade.riskAmount}
              </p>
              <p>
                <strong>Risk Dev:</strong>{" "}
                <span className={trade.isOverRisked ? "text-red-600" : trade.isUnderRisked ? "text-orange-600" : "text-green-600"}>
                  {(trade.riskDeviation || 0).toFixed(1)}%
                </span>
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h4 className="font-semibold mb-2">Review</h4>
            <ReviewDetails trade={trade} setups={setups} />
          </div>

          {trade.tags.length > 0 && (
            <div>
              <h4 className="font-semibold">Tags</h4>
              <div className="flex flex-wrap gap-2">
                {trade.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {trade.notes && (
            <div className="bg-gray-100 dark:bg-gray-800 p-5 rounded-lg">
              <h4 className="font-semibold text-xl text-center">Notes</h4>
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{trade.notes}</ReactMarkdown>
              </div>
            </div>
          )}

          {trade.screenshot && (
            <div>
              <h4 className="font-semibold">Screenshot</h4>
              <img
                src={trade.screenshot || "/placeholder.svg"}
                alt="Trade screenshot"
                className="max-w-full h-auto rounded-lg border"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
