import { Badge } from "./Badge";
import { ConnectionStatus, PublishStatus } from "@/types";

type Status = ConnectionStatus | PublishStatus;

const toneByStatus: Record<string, "green" | "red" | "amber" | "blue" | "orange" | "gray"> = {
  // ConnectionStatus
  CONNECTED: "green",
  NOT_CONFIGURED: "gray",
  APPROVAL_REQUIRED: "amber",
  AUTH_REQUIRED: "orange",
  TOKEN_EXPIRED: "orange",
  RECONNECT_REQUIRED: "orange",
  BLOCKED: "red",
  DISCONNECTED: "red",
  // PublishStatus
  PUBLISHED: "green",
  FAILED: "red",
  SCHEDULED: "blue",
  PROCESSING: "blue",
  READY: "amber",
  PARTIALLY_PUBLISHED: "amber",
  DRAFT: "gray",
  CANCELLED: "gray",
};

export function StatusBadge({ status }: { status: Status }) {
  const tone = toneByStatus[status] ?? "gray";
  const label = status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return <Badge tone={tone}>{label}</Badge>;
}
