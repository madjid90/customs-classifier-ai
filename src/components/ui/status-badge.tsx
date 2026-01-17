import { CaseStatus, CASE_STATUS_LABELS, ConfidenceLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: CaseStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusStyles: Record<CaseStatus, string> = {
    IN_PROGRESS: "badge-info",
    RESULT_READY: "badge-warning",
    VALIDATED: "badge-success",
    ERROR: "badge-error",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
        className
      )}
    >
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  percentage?: number;
  className?: string;
}

export function ConfidenceBadge({ level, percentage, className }: ConfidenceBadgeProps) {
  const levelStyles: Record<ConfidenceLevel, string> = {
    high: "badge-success",
    medium: "badge-warning",
    low: "badge-error",
  };

  const levelLabels: Record<ConfidenceLevel, string> = {
    high: "Elevee",
    medium: "Moyenne",
    low: "Faible",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        levelStyles[level],
        className
      )}
    >
      {levelLabels[level]}
      {percentage !== undefined && (
        <span className="font-mono">({Math.round(percentage * 100)}%)</span>
      )}
    </span>
  );
}

interface IngestionStatusBadgeProps {
  status: string;
  className?: string;
}

export function IngestionStatusBadge({ status, className }: IngestionStatusBadgeProps) {
  const statusStyles: Record<string, string> = {
    NEW: "badge-neutral",
    EXTRACTING: "badge-info",
    PARSING: "badge-info",
    INDEXING: "badge-info",
    DONE: "badge-success",
    ERROR: "badge-error",
    DISABLED: "badge-neutral",
  };

  const statusLabels: Record<string, string> = {
    NEW: "Nouveau",
    EXTRACTING: "Extraction",
    PARSING: "Analyse",
    INDEXING: "Indexation",
    DONE: "Termine",
    ERROR: "Erreur",
    DISABLED: "Desactive",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] || "badge-neutral",
        className
      )}
    >
      {statusLabels[status] || status}
    </span>
  );
}
