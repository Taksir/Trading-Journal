"use client"

import { ClipboardCheck, ChevronRight } from "lucide-react"

interface ReviewReminderProps {
  count: number
  onClick: () => void
}

/**
 * Compact, clickable review reminder for the main page. Shows how many scoped
 * trades still need review and jumps to the Review tab on click. When everything
 * is reviewed it collapses into a de-emphasized "all caught up" notice.
 */
export function ReviewReminder({ count, onClick }: ReviewReminderProps) {
  if (count <= 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
      >
        <ClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">All trades reviewed</span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-left text-sm transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
    >
      <ClipboardCheck className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
      <span className="font-medium text-amber-900 dark:text-amber-300">
        Review &nbsp;·&nbsp; {count} trade{count === 1 ? "" : "s"} need review
      </span>
      <span className="text-xs text-amber-700 dark:text-amber-400">Open Review tab</span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
    </button>
  )
}
