"use client"

import { useEffect, useRef, useState } from "react"
import {
  createChart,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type HistogramData,
  type MouseEventParams,
  type Time,
} from "lightweight-charts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Crosshair, Maximize2 } from "lucide-react"
import type { PnlChartPoint } from "@/utils/pnl-series"

interface PnlChartProps {
  points: PnlChartPoint[]
}

type Mode = "pnl" | "equity"

const POSITIVE_COLOR = "#16a34a" // text-green-600 (journal convention)
const NEGATIVE_COLOR = "#dc2626" // text-red-600 (journal convention)
const NEUTRAL_COLOR = "#94a3b8" // slate-400

/** Detect dark mode by watching the `.dark` class on <html> (theme-agnostic). */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function readCssColor(variable: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value ? `hsl(${value})` : fallback
}

function toDateKey(time: Time): string {
  if (typeof time === "string") return time
  if (typeof time === "object" && time !== null) {
    const day = time as { year: number; month: number; day: number }
    const mm = String(day.month).padStart(2, "0")
    const dd = String(day.day).padStart(2, "0")
    return `${day.year}-${mm}-${dd}`
  }
  return String(time)
}

function formatUsd(value: number, decimals = 0): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${value < 0 ? "-" : "+"}$${formatted}`
}

function formatDateKey(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function formatSince(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
}

interface HistogramItem extends HistogramData<Time> {
  custom?: { tradeCount: number; returnPct: number | null }
}

interface HoverInfo {
  date: string
  dailyPnl: number
  value: number
  tradeCount: number
  returnPct: number | null
  x: number
  y: number
}

export function PnlChart({ points }: PnlChartProps) {
  const [mode, setMode] = useState<Mode>("pnl")
  const [hovered, setHovered] = useState<HoverInfo | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null)
  const histRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const dark = useDarkMode()

  const last = points.length > 0 ? points[points.length - 1] : null
  const headerValue = last ? (mode === "equity" ? (last.equity ?? last.cumulativePnl) : last.cumulativePnl) : 0
  const sinceLabel = points.length > 0 ? formatSince(points[0].date) : ""

  // Create the chart once. All series data is re-applied in the effect below,
  // so the chart reacts immediately to journal data changes (import/edit/delete/
  // scope switch) with no manual refresh.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const textColor = readCssColor("--foreground", "#09090b")
    const gridColor = readCssColor("--border", "rgba(0,0,0,0.08)")
    const borderColor = readCssColor("--border", "rgba(0,0,0,0.12)")

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        fontSize: 11,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor,
        timeVisible: false,
        rightOffset: 4,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: borderColor, width: 1, style: 3, labelBackgroundColor: textColor },
        horzLine: { color: borderColor, width: 1, style: 3, labelBackgroundColor: textColor },
      },
    })

    const line = chart.addSeries(
      LineSeries,
      {
        lineWidth: 2,
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineStyle: 2,
      },
      0,
    )
    const hist = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        lastValueVisible: false,
        priceLineVisible: false,
        base: 0,
      },
      1,
    )
    chart.panes()[1]?.setHeight(90)

    chartRef.current = chart
    lineRef.current = line
    histRef.current = hist

    const crosshairHandler = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.point) {
        setHovered(null)
        return
      }
      const histItem = param.seriesData.get(hist) as HistogramItem | undefined
      const lineItem = param.seriesData.get(line) as LineData<Time> | undefined
      if (!histItem) {
        setHovered(null)
        return
      }
      setHovered({
        date: toDateKey(param.time),
        dailyPnl: histItem.value,
        value: lineItem?.value ?? 0,
        tradeCount: histItem.custom?.tradeCount ?? 0,
        returnPct: histItem.custom?.returnPct ?? null,
        x: param.point.x,
        y: param.point.y,
      })
    }
    chart.subscribeCrosshairMove(crosshairHandler)

    return () => {
      chart.unsubscribeCrosshairMove(crosshairHandler)
      chart.remove()
      chartRef.current = null
      lineRef.current = null
      histRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-theme the chart when the app theme changes (the `.dark` class toggling
  // only changes CSS variables; lightweight-charts needs explicit colors).
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const textColor = readCssColor("--foreground", "#09090b")
    const gridColor = readCssColor("--border", "rgba(0,0,0,0.08)")
    const borderColor = readCssColor("--border", "rgba(0,0,0,0.12)")
    chart.applyOptions({
      layout: { textColor, background: { type: ColorType.Solid, color: "transparent" } },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
      crosshair: {
        vertLine: { color: borderColor, labelBackgroundColor: textColor },
        horzLine: { color: borderColor, labelBackgroundColor: textColor },
      },
    })
  }, [dark])

  // Push data into the chart whenever the journal data or the mode changes.
  // P&L mode plots cumulative realized P&L; Equity mode plots the real account
  // balance curve. The daily histogram (realized P&L per day) is shared.
  useEffect(() => {
    const chart = chartRef.current
    const line = lineRef.current
    const hist = histRef.current
    if (!chart || !line || !hist || points.length === 0) return

    const lineData: LineData<Time>[] = points.map((point) => ({
      time: point.date as Time,
      value: mode === "equity" ? (point.equity ?? point.cumulativePnl) : point.cumulativePnl,
    }))
    const histData: HistogramItem[] = points.map((point) => ({
      time: point.date as Time,
      value: point.dailyPnl,
      color: point.dailyPnl > 0 ? POSITIVE_COLOR : point.dailyPnl < 0 ? NEGATIVE_COLOR : NEUTRAL_COLOR,
      custom: { tradeCount: point.tradeCount, returnPct: point.returnPct },
    }))

    const lastValue = lineData[lineData.length - 1].value
    line.setData(lineData)
    hist.setData(histData)
    line.applyOptions({
      color: mode === "equity" ? "#3b82f6" : lastValue >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR,
    })

    // Auto-fit so new data is never cut off; the user can still zoom/pan freely.
    chart.timeScale().fitContent()
  }, [points, mode])

  const resetView = () => {
    chartRef.current?.timeScale().fitContent()
  }

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trading P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            No realized P&L yet.
            <br />
            Close or import trades to build your P&L history.
          </p>
        </CardContent>
      </Card>
    )
  }

  const tooltipWidth = 220
  const tooltipLeft = hovered ? (hovered.x + tooltipWidth > (containerRef.current?.clientWidth ?? 0) ? hovered.x - tooltipWidth - 12 : hovered.x + 14) : 0
  const tooltipTop = hovered ? Math.max(8, hovered.y - 40) : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Trading P&L</CardTitle>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={`text-2xl font-semibold tabular-nums ${headerValue >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {formatUsd(headerValue)}
              </span>
              {sinceLabel && <span className="text-sm text-muted-foreground">Since {sinceLabel}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => setMode("pnl")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "pnl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                P&L
              </button>
              <button
                type="button"
                onClick={() => setMode("equity")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "equity" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Equity
              </button>
            </div>
            <button
              type="button"
              onClick={resetView}
              title="Reset zoom"
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div ref={containerRef} className="h-[320px] w-full md:h-[380px]" />
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-md"
              style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth }}
            >
              <div className="mb-1 flex items-center gap-1 font-medium">
                <Crosshair className="h-3 w-3 text-muted-foreground" />
                {formatDateKey(hovered.date)}
              </div>
              <dl className="space-y-0.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{mode === "equity" ? "Account balance" : "Cumulative P&L"}</dt>
                  <dd className="tabular-nums">{formatUsd(hovered.value)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Daily P&L</dt>
                  <dd className="tabular-nums">{formatUsd(hovered.dailyPnl)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Trades closed</dt>
                  <dd className="tabular-nums">{hovered.tradeCount}</dd>
                </div>
                {hovered.returnPct !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Daily return</dt>
                    <dd className={`tabular-nums ${hovered.returnPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {hovered.returnPct >= 0 ? "+" : ""}
                      {hovered.returnPct.toFixed(2)}%
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cumulative realized trading P&L by close date. Drag to pan, scroll to zoom, hover for details.
        </p>
      </CardContent>
    </Card>
  )
}
