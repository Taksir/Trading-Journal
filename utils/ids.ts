/**
 * Local id generation. Deliberately dependency-free: ids only need to be unique
 * within this device's journal, so a timestamp + random suffix is sufficient.
 */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
