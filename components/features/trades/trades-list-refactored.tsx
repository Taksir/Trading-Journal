"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Edit3 } from "lucide-react"
import type { Trade, FilterOptions } from "@/types/trade"
import type { TradingAccount } from "@/types/account"
import type { Setup } from "@/types/setup"
import { TradeEntryForm } from "../../trade-entry-form"
import { BulkUpdateDialogWrapper } from "../../shared/bulk-update-dialog-wrapper"
import { AdvancedFilterDialogWrapper } from "../../shared/advanced-filter-dialog-wrapper"
import { TradeFilters } from "./trade-filters"
import { TradeTable } from "./trade-table"
import { PaginationControls } from "../../shared/pagination-controls"
import { TradeDetailDialog } from "../review/trade-detail-dialog"
import { useTradeFilters } from "@/hooks/use-trade-filters"
import { useTradeSorting } from "@/hooks/use-trade-sorting"
import { usePagination } from "@/hooks/use-pagination"

interface TradesListProps {
  trades: Trade[]
  onDeleteTrade: (id: string) => void
  onUpdateTrade: (trade: Trade) => void
  onBulkUpdate: (tradeIds: string[], updates: Partial<Trade>) => void
  settings: any
  accounts?: TradingAccount[]
  setups?: Setup[]
}

export function TradesList({
  trades,
  onDeleteTrade,
  onUpdateTrade,
  onBulkUpdate,
  settings,
  accounts,
  setups = [],
}: TradesListProps) {
  // State for dialogs and UI
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null)
  const [viewingTrade, setViewingTrade] = useState<Trade | null>(null)
  const [selectedTrades, setSelectedTrades] = useState<string[]>([])
  const [showBulkUpdate, setShowBulkUpdate] = useState(false)
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false)

  // Custom hooks for filtering, sorting, and pagination
  const {
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    advancedFilters,
    setAdvancedFilters,
    filteredTrades,
    filterOptions,
  } = useTradeFilters({ trades })

  const { sortField, sortDirection, sortedTrades, handleSort } = useTradeSorting({
    trades: filteredTrades
  })

  const {
    currentPage,
    itemsPerPage,
    totalPages,
    startIndex,
    endIndex,
    handleItemsPerPageChange,
    goToPage,
  } = usePagination({
    totalItems: sortedTrades.length
  })

  // Get paginated trades
  const paginatedTrades = sortedTrades.slice(startIndex, endIndex)

  // Selection handlers
  const handleSelectTrade = (tradeId: string) => {
    setSelectedTrades((prev) =>
      prev.includes(tradeId)
        ? prev.filter((id) => id !== tradeId)
        : [...prev, tradeId]
    )
  }

  const handleSelectAllOnPage = () => {
    const currentPageTradeIds = paginatedTrades.map((trade) => trade.id)
    const allCurrentPageSelected = currentPageTradeIds.every((id) => selectedTrades.includes(id))

    if (allCurrentPageSelected) {
      setSelectedTrades((prev) => prev.filter((id) => !currentPageTradeIds.includes(id)))
    } else {
      setSelectedTrades((prev) => [...new Set([...prev, ...currentPageTradeIds])])
    }
  }

  // Dialog handlers
  const handleBulkUpdate = (updates: Partial<Trade>) => {
    onBulkUpdate(selectedTrades, updates)
    setSelectedTrades([])
    setShowBulkUpdate(false)
  }

  const handleAdvancedFiltersChange = (newFilters: FilterOptions) => {
    setAdvancedFilters(newFilters)
    setShowAdvancedFilter(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Trading Journal</CardTitle>
            <CardDescription>
              {filteredTrades.length} of {trades.length} trades
            </CardDescription>
          </div>
          {selectedTrades.length > 0 && (
            <Button onClick={() => setShowBulkUpdate(true)} variant="outline">
              <Edit3 className="h-4 w-4 mr-2" />
              Bulk Update ({selectedTrades.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <TradeFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filters={filters}
          onFiltersChange={setFilters}
          filterOptions={filterOptions}
          setups={setups}
          onShowAdvancedFilters={() => setShowAdvancedFilter(true)}
        />

        <TradeTable
          trades={paginatedTrades}
          selectedTrades={selectedTrades}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onSelectTrade={handleSelectTrade}
          onSelectAllOnPage={handleSelectAllOnPage}
          onEditTrade={setEditingTrade}
          onViewTrade={setViewingTrade}
          onDeleteTrade={onDeleteTrade}
          accounts={accounts}
          setups={setups}
        />

        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          totalItems={sortedTrades.length}
          onPageChange={goToPage}
          onItemsPerPageChange={handleItemsPerPageChange}
        />
      </CardContent>

      {/* Edit Trade Dialog */}
      {editingTrade && (
        <TradeEntryForm
          initialData={editingTrade}
          onSubmit={(updatedTrade: Omit<Trade, "id">) => {
            onUpdateTrade({ ...updatedTrade, id: editingTrade.id })
            setEditingTrade(null)
          }}
          onCancel={() => setEditingTrade(null)}
          settings={settings}
          accounts={accounts}
        />
      )}

      {/* View Trade Dialog */}
      <TradeDetailDialog
        open={!!viewingTrade}
        trade={viewingTrade}
        setups={setups}
        accounts={accounts}
        onClose={() => setViewingTrade(null)}
      />

      {/* Bulk Update Dialog */}
      {showBulkUpdate && (
        <BulkUpdateDialogWrapper
          open={showBulkUpdate}
          onOpenChange={setShowBulkUpdate}
          onUpdate={handleBulkUpdate}
          selectedTrades={selectedTrades.map(id => trades.find(t => t.id === id)!).filter(Boolean)}
          settings={settings}
        />
      )}

      {/* Advanced Filter Dialog */}
      {showAdvancedFilter && (
        <AdvancedFilterDialogWrapper
          open={showAdvancedFilter}
          onOpenChange={setShowAdvancedFilter}
          filters={advancedFilters}
          onFiltersChange={handleAdvancedFiltersChange}
          trades={trades}
        />
      )}
    </Card>
  )
}
