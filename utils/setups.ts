import type { Setup } from "../types/setup.ts"
import { DEFAULT_SETUPS } from "../types/setup.ts"

/**
 * Setups registry.
 *
 * Built-in setups always exist. Custom setups can be added in future phases;
 * they are stored with the journal state and merged over the built-ins.
 * Analytics key off `setupId`, never off the display name.
 */

export const SETUPS_STORAGE_KEY = "trading-journal-setups"

export function mergeSetups(stored: Setup[] | undefined | null): Setup[] {
  const custom = Array.isArray(stored)
    ? stored.filter((setup) => setup && !setup.builtIn)
    : []
  const knownIds = new Set(DEFAULT_SETUPS.map((setup) => setup.id))
  const customDeduped = custom.filter((setup) => !knownIds.has(setup.id))
  return [...DEFAULT_SETUPS, ...customDeduped]
}

export function getSetupName(setups: Setup[], setupId: string | undefined | null): string | null {
  if (!setupId) return null
  const setup = setups.find((candidate) => candidate.id === setupId)
  return setup ? setup.name : null
}

export function ensureSetupIdExists(setups: Setup[], setupId: string | undefined | null): string | null {
  if (!setupId) return null
  return setups.some((setup) => setup.id === setupId) ? setupId : null
}
