/**
 * Notification dedupe keys.
 *
 * The hourly job re-scans a rolling 7-day window, so it sees the same tender
 * ~168 times. Without a hard dedupe key a user would receive 168 emails.
 *
 * Why a computed string and not a unique index on (filterSetId, tenderId,
 * type, closingDate): Postgres treats NULLs as DISTINCT in unique indexes, so
 * for `new_match` (where closingDate is NULL) the constraint would not prevent
 * duplicates. An explicit key sidesteps that entirely.
 */

export type NotificationType = "new_match" | "expiring";

export interface DedupeInput {
  filterSetId: string;
  tenderId: string;
  type: NotificationType;
  closingDate?: Date | null;
}

export function buildDedupeKey(input: DedupeInput): string {
  if (input.type === "expiring") {
    // Including the deadline is what makes an EXTENDED deadline re-arm the
    // alert: a new closingDate produces a new key. Without it, a tender whose
    // deadline moved would either re-alert pointlessly or fall silent.
    const stamp = input.closingDate ? new Date(input.closingDate).toISOString() : "unknown";
    return `${input.filterSetId}:${input.tenderId}:expiring:${stamp}`;
  }
  // new_match fires once, ever — deliberately NOT keyed on any mutable field.
  return `${input.filterSetId}:${input.tenderId}:new_match`;
}
