import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TaskType = 
  | "embeddings_hs" 
  | "embeddings_kb" 
  | "enrichment_hs" 
  | "sync_hs_laws";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface BackgroundTask {
  id: string;
  task_type: TaskType;
  status: TaskStatus;
  source_id?: string;
  items_total: number;
  items_processed: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  created_by?: string;
}

/**
 * Create a new background task record
 */
export async function createBackgroundTask(
  supabase: SupabaseClient,
  taskType: TaskType,
  options?: {
    sourceId?: string;
    itemsTotal?: number;
    createdBy?: string;
  }
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("background_tasks")
      .insert({
        task_type: taskType,
        status: "running",
        source_id: options?.sourceId,
        items_total: options?.itemsTotal || 0,
        items_processed: 0,
        created_by: options?.createdBy,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("[background-tasks] Create error:", error);
      return null;
    }

    console.log(`[background-tasks] Created task ${data.id} of type ${taskType}`);
    return data.id;
  } catch (e) {
    console.error("[background-tasks] Create exception:", e);
    return null;
  }
}

/**
 * Update task progress
 */
export async function updateTaskProgress(
  supabase: SupabaseClient,
  taskId: string,
  itemsProcessed: number,
  itemsTotal?: number
): Promise<void> {
  try {
    const updateData: Record<string, unknown> = {
      items_processed: itemsProcessed,
    };
    
    if (itemsTotal !== undefined) {
      updateData.items_total = itemsTotal;
    }

    await supabase
      .from("background_tasks")
      .update(updateData)
      .eq("id", taskId);
  } catch (e) {
    console.error("[background-tasks] Update progress error:", e);
  }
}

/**
 * Complete a task successfully
 */
export async function completeTask(
  supabase: SupabaseClient,
  taskId: string,
  itemsProcessed: number,
  itemsTotal?: number
): Promise<void> {
  try {
    await supabase
      .from("background_tasks")
      .update({
        status: "completed",
        items_processed: itemsProcessed,
        items_total: itemsTotal ?? itemsProcessed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    console.log(`[background-tasks] Completed task ${taskId}: ${itemsProcessed} items`);
  } catch (e) {
    console.error("[background-tasks] Complete error:", e);
  }
}

/**
 * Mark a task as failed
 */
export async function failTask(
  supabase: SupabaseClient,
  taskId: string,
  errorMessage: string,
  itemsProcessed?: number
): Promise<void> {
  try {
    const updateData: Record<string, unknown> = {
      status: "failed",
      error_message: errorMessage.substring(0, 1000), // Limit error message length
      completed_at: new Date().toISOString(),
    };

    if (itemsProcessed !== undefined) {
      updateData.items_processed = itemsProcessed;
    }

    await supabase
      .from("background_tasks")
      .update(updateData)
      .eq("id", taskId);

    console.log(`[background-tasks] Failed task ${taskId}: ${errorMessage}`);
  } catch (e) {
    console.error("[background-tasks] Fail error:", e);
  }
}

/**
 * Wrapper to run a task with automatic status tracking
 */
export async function runTrackedTask<T>(
  supabase: SupabaseClient,
  taskType: TaskType,
  taskFn: (taskId: string) => Promise<{ processed: number; total: number; result?: T }>,
  options?: {
    sourceId?: string;
    createdBy?: string;
  }
): Promise<{ taskId: string | null; result?: T; error?: string }> {
  const taskId = await createBackgroundTask(supabase, taskType, options);
  
  if (!taskId) {
    return { taskId: null, error: "Failed to create task record" };
  }

  try {
    const { processed, total, result } = await taskFn(taskId);
    await completeTask(supabase, taskId, processed, total);
    return { taskId, result };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    await failTask(supabase, taskId, errorMessage);
    return { taskId, error: errorMessage };
  }
}
