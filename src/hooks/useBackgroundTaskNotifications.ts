import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RealtimeChannel } from "@supabase/supabase-js";

interface BackgroundTask {
  id: string;
  task_type: string;
  status: string;
  items_total: number;
  items_processed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  embeddings_hs: "Embeddings HS",
  embeddings_kb: "Embeddings KB",
  enrichment_hs: "Enrichissement HS",
  sync_hs_laws: "Sync HS depuis lois",
};

const STATUS_MESSAGES: Record<string, { title: string; variant: "default" | "destructive" }> = {
  completed: { title: "Tâche terminée", variant: "default" },
  failed: { title: "Tâche échouée", variant: "destructive" },
};

export function useBackgroundTaskNotifications() {
  const { toast } = useToast();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const notifiedTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Subscribe to background_tasks changes
    const channel = supabase
      .channel("background_tasks_notifications")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "background_tasks",
        },
        (payload) => {
          const task = payload.new as BackgroundTask;
          
          // Only notify for completed or failed tasks that haven't been notified yet
          if (
            (task.status === "completed" || task.status === "failed") &&
            !notifiedTasksRef.current.has(task.id)
          ) {
            notifiedTasksRef.current.add(task.id);
            
            const taskLabel = TASK_TYPE_LABELS[task.task_type] || task.task_type;
            const statusInfo = STATUS_MESSAGES[task.status] || STATUS_MESSAGES.completed;
            
            if (task.status === "completed") {
              toast({
                title: `✅ ${statusInfo.title}`,
                description: `${taskLabel}: ${task.items_processed}/${task.items_total} éléments traités`,
                variant: statusInfo.variant,
              });
            } else if (task.status === "failed") {
              toast({
                title: `❌ ${statusInfo.title}`,
                description: `${taskLabel}: ${task.error_message || "Erreur inconnue"}`,
                variant: statusInfo.variant,
              });
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "background_tasks",
        },
        (payload) => {
          const task = payload.new as BackgroundTask;
          const taskLabel = TASK_TYPE_LABELS[task.task_type] || task.task_type;
          
          if (task.status === "running") {
            toast({
              title: `⏳ Tâche démarrée`,
              description: `${taskLabel} en cours...`,
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    // Cleanup on unmount
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [toast]);

  // Clear notified tasks cache periodically (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      notifiedTasksRef.current.clear();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);
}
