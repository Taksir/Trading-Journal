"use client"

import { MISTAKES } from "@/types/review"
import { cn } from "@/lib/utils"

interface MistakePickerProps {
  value: string[]
  onChange: (ids: string[]) => void
}

/** Multi-select chips for the mistake catalog. A trade is tagged once per id. */
export function MistakePicker({ value, onChange }: MistakePickerProps) {
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((existing) => existing !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MISTAKES.map((mistake) => {
        const active = value.includes(mistake.id)
        return (
          <button
            key={mistake.id}
            type="button"
            onClick={() => toggle(mistake.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {mistake.label}
          </button>
        )
      })}
    </div>
  )
}
