/**
 * Trade setup classification (chart pattern / edge type).
 *
 * Setups are entities with stable ids so analytics can later group by setup and
 * so the user can eventually create custom setups. Built-in setups are always
 * present; custom setups may be stored separately (see `utils/setups.ts`).
 */

export interface Setup {
  id: string
  name: string
  /** True for the built-in defaults; false for user-created setups. */
  builtIn: boolean
}

export const BUILT_IN_SETUP_IDS = {
  breakout: "setup-breakout",
  pullback: "setup-pullback",
  episodicPivot: "setup-episodic-pivot",
  earningsGap: "setup-earnings-gap",
  meanReversion: "setup-mean-reversion",
  undercutAndRally: "setup-undercut-and-rally",
  other: "setup-other",
} as const

export const DEFAULT_SETUPS: Setup[] = [
  { id: BUILT_IN_SETUP_IDS.breakout, name: "Breakout", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.pullback, name: "Pullback", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.episodicPivot, name: "Episodic Pivot", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.earningsGap, name: "Earnings Gap", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.meanReversion, name: "Mean Reversion", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.undercutAndRally, name: "Undercut & Rally", builtIn: true },
  { id: BUILT_IN_SETUP_IDS.other, name: "Other", builtIn: true },
]
