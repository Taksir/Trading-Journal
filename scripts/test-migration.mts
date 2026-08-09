/**
 * Deterministic tests for the durable-ordering journal initialization core
 * (persistMigratedJournal in utils/account-migration.ts).
 *
 * Invariant under test: `schemaVersion == CURRENT_SCHEMA_VERSION` in storage
 * implies the migrated journal has ALREADY been durably written. Therefore:
 * - the schema version is the FINAL write, strictly after every migrated entry
 * - if persistence fails partway (interrupted migration), the schema version is
 *   NOT advanced, hydration is NOT unlocked, and the next load retries
 *   (migration is idempotent)
 * - a stored version greater than the current schema means future-schema
 *   read-only: nothing is written at all
 *
 * Run with: npm run test:migration
 */
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, persistMigratedJournal } from "../utils/account-migration.ts"
import type { JournalStorage } from "../utils/account-migration.ts"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

const ENTRIES = [
  { key: "trading-journal-trades", value: "[trade]" },
  { key: "trading-journal-accounts", value: "[account]" },
  { key: "trading-journal-settings", value: "[settings]" },
]

// In-memory fake storage. With `failAfter` set, the Nth setItem throws —
// deterministically simulating an interrupted migration (e.g. quota exceeded).
// `failAfter` is mutable so a test can let the NEXT run succeed.
function fakeStorage(failAfter?: number): JournalStorage & { store: Map<string, string>; writes: string[]; failAfter?: number } {
  const store = new Map<string, string>()
  const writes: string[] = []
  let calls = 0
  return {
    store,
    writes,
    failAfter,
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string): void {
      writes.push(key)
      calls += 1
      if (this.failAfter !== undefined && calls === this.failAfter) {
        throw new Error(`simulated write failure at call ${calls}`)
      }
      store.set(key, value)
    },
  }
}

console.log("persistMigratedJournal: future-schema read-only")

{
  const storage = fakeStorage()
  const outcome = persistMigratedJournal({
    storedSchemaVersion: CURRENT_SCHEMA_VERSION + 1,
    entries: ENTRIES,
    storage,
  })
  assert(outcome === "future-schema-readonly", "returns future-schema-readonly for a newer stored schema")
  assert(storage.writes.length === 0, "writes NOTHING in future-schema read-only mode")
  assert(storage.store.size === 0, "no data key is touched for a newer schema")
}

console.log("persistMigratedJournal: successful migration ordering")

{
  const storage = fakeStorage()
  const outcome = persistMigratedJournal({ storedSchemaVersion: null, entries: ENTRIES, storage })
  assert(outcome === "hydrated", "legacy/no-version migration succeeds with hydrated")
  assert(
    storage.writes[storage.writes.length - 1] === SCHEMA_VERSION_KEY,
    "schema version is the FINAL durable write",
  )
  assert(
    JSON.stringify(storage.writes) ===
      JSON.stringify([...ENTRIES.map((e) => e.key), SCHEMA_VERSION_KEY]),
    "every migrated entry is written before the schema version",
  )
  assert(storage.store.get(SCHEMA_VERSION_KEY) === String(CURRENT_SCHEMA_VERSION), "schema version is current")
  assert(storage.store.get(ENTRIES[0].key) === ENTRIES[0].value, "migrated trades are durably persisted")
}

console.log("persistMigratedJournal: interrupted migration must NOT advance the schema version")

for (const failCall of [1, 2, ENTRIES.length, ENTRIES.length + 1]) {
  const storage = fakeStorage(failCall)
  const outcome = persistMigratedJournal({ storedSchemaVersion: null, entries: ENTRIES, storage })
  assert(
    outcome === "storage-error-readonly",
    `failure on write #${failCall} returns storage-error-readonly (never claims migration complete)`,
  )
  assert(
    !storage.store.has(SCHEMA_VERSION_KEY),
    `failure on write #${failCall} leaves the schema version NOT advanced`,
  )
}

console.log("persistMigratedJournal: idempotent re-run after an interrupted migration")

{
  // First run fails on the final entry; schema version must not advance.
  const storage = fakeStorage(ENTRIES.length)
  const first = persistMigratedJournal({ storedSchemaVersion: null, entries: ENTRIES, storage })
  assert(first === "storage-error-readonly", "interrupted first run reports read-only")
  assert(!storage.store.has(SCHEMA_VERSION_KEY), "schema version absent after interrupted first run")

  // Second run (same storage, no failure) must fully migrate and advance.
  storage.failAfter = undefined
  const second = persistMigratedJournal({ storedSchemaVersion: null, entries: ENTRIES, storage })
  assert(second === "hydrated", "second run completes with hydrated")
  assert(storage.store.get(SCHEMA_VERSION_KEY) === String(CURRENT_SCHEMA_VERSION), "version advanced on retry")
  assert(
    storage.writes[storage.writes.length - 1] === SCHEMA_VERSION_KEY,
    "version is still the final write on retry",
  )
}

console.log("persistMigratedJournal: already-migrated journal rehydrates cleanly")

{
  const storage = fakeStorage()
  storage.setItem(SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION))
  storage.setItem(ENTRIES[0].key, ENTRIES[0].value)
  const outcome = persistMigratedJournal({
    storedSchemaVersion: CURRENT_SCHEMA_VERSION,
    entries: ENTRIES,
    storage,
  })
  assert(outcome === "hydrated", "matching stored version rehydrates without an error banner")
  assert(
    storage.store.get(SCHEMA_VERSION_KEY) === String(CURRENT_SCHEMA_VERSION),
    "already-current version is written back idempotently",
  )
}

console.log(`\nmigration: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
