export type SessionActivityRecord = {
  id: string;
  pinnedAt?: string | null;
  lastActiveAt?: string | null;
  createdAt: string;
};

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareIdsDesc(left: string, right: string): number {
  if (left === right) return 0;
  return right > left ? 1 : -1;
}

export function sessionActivityTimestamp(session: SessionActivityRecord): number {
  return timestamp(session.lastActiveAt) || timestamp(session.createdAt);
}

export function compareSessionsByActivity(
  left: SessionActivityRecord,
  right: SessionActivityRecord,
): number {
  const leftPinned = Boolean(left.pinnedAt);
  const rightPinned = Boolean(right.pinnedAt);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

  return (
    sessionActivityTimestamp(right) - sessionActivityTimestamp(left) ||
    timestamp(right.createdAt) - timestamp(left.createdAt) ||
    compareIdsDesc(left.id, right.id)
  );
}
