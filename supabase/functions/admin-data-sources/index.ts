import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { logger } from "../_shared/logger.ts";

interface DataSourceInput {
  name: string;
  url: string;
  base_url?: string;
  description?: string;
  source_type: string;
  kb_source: string;
  schedule_cron?: string;
  version_label: string;
  scrape_config: Record<string, unknown>;
  status?: string;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate - admin required
    const authResult = await authenticateRequest(req, { requireRole: ["admin"] });
    if (!authResult.success) {
      return authResult.error;
    }

    const { user } = authResult.data;
    const supabase = createServiceClient();
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    
    // Extract source ID: URL format is /functions/v1/admin-data-sources or /functions/v1/admin-data-sources/{id}
    // pathParts could be ["functions", "v1", "admin-data-sources"] or ["functions", "v1", "admin-data-sources", "{id}"]
    // or just ["admin-data-sources"] / ["admin-data-sources", "{id}"] depending on runtime
    let sourceId: string | null = null;
    const adminFunctionIdx = pathParts.findIndex(p => p === "admin-data-sources");
    if (adminFunctionIdx !== -1 && pathParts.length > adminFunctionIdx + 1) {
      sourceId = pathParts[adminFunctionIdx + 1];
    }
    
    logger.info(`[admin-data-sources] Method: ${req.method}, Path: ${url.pathname}, sourceId: ${sourceId}`);

    // GET - List all data sources or get one by ID
    if (req.method === "GET") {
      if (sourceId && sourceId !== "admin-data-sources") {
        const { data, error } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", sourceId)
          .single();

        if (error) {
          logger.error("[admin-data-sources] Error fetching source:", error);
          return new Response(
            JSON.stringify({ error: "Source not found", code: "NOT_FOUND" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify(data),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        logger.error("[admin-data-sources] Error listing sources:", error);
        return new Response(
          JSON.stringify({ error: "Failed to fetch sources", code: "FETCH_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify(data || []),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST - Create new data source
    if (req.method === "POST") {
      const body: DataSourceInput = await req.json();

      if (!body.name?.trim() || !body.url?.trim()) {
        return new Response(
          JSON.stringify({ error: "Name and URL are required", code: "VALIDATION_ERROR" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase
        .from("data_sources")
        .insert({
          name: body.name.trim(),
          url: body.url.trim(),
          base_url: body.base_url || new URL(body.url).origin,
          description: body.description?.trim() || null,
          source_type: body.source_type,
          kb_source: body.kb_source,
          schedule_cron: body.schedule_cron?.trim() || null,
          version_label: body.version_label?.trim() || "auto",
          scrape_config: body.scrape_config || {},
          created_by: user.id,
          status: body.status || "active",
        })
        .select()
        .single();

      if (error) {
        logger.error("[admin-data-sources] Error creating source:", error);
        return new Response(
          JSON.stringify({ error: "Failed to create source", code: "CREATE_ERROR", details: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.info(`[admin-data-sources] Created source: ${data.id} by user ${user.id}`);
      return new Response(
        JSON.stringify(data),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUT - Update data source
    if (req.method === "PUT") {
      if (!sourceId || sourceId === "admin-data-sources") {
        return new Response(
          JSON.stringify({ error: "Source ID required", code: "MISSING_ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body: Partial<DataSourceInput> = await req.json();

      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.url !== undefined) {
        updateData.url = body.url.trim();
        updateData.base_url = new URL(body.url).origin;
      }
      if (body.description !== undefined) updateData.description = body.description?.trim() || null;
      if (body.source_type !== undefined) updateData.source_type = body.source_type;
      if (body.kb_source !== undefined) updateData.kb_source = body.kb_source;
      if (body.schedule_cron !== undefined) updateData.schedule_cron = body.schedule_cron?.trim() || null;
      if (body.version_label !== undefined) updateData.version_label = body.version_label.trim();
      if (body.scrape_config !== undefined) updateData.scrape_config = body.scrape_config;
      if (body.status !== undefined) updateData.status = body.status;

      const { data, error } = await supabase
        .from("data_sources")
        .update(updateData)
        .eq("id", sourceId)
        .select()
        .single();

      if (error) {
        logger.error("[admin-data-sources] Error updating source:", error);
        return new Response(
          JSON.stringify({ error: "Failed to update source", code: "UPDATE_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.info(`[admin-data-sources] Updated source: ${sourceId}`);
      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH - Toggle status or partial update
    if (req.method === "PATCH") {
      if (!sourceId || sourceId === "admin-data-sources") {
        return new Response(
          JSON.stringify({ error: "Source ID required", code: "MISSING_ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();

      const { data, error } = await supabase
        .from("data_sources")
        .update(body)
        .eq("id", sourceId)
        .select()
        .single();

      if (error) {
        logger.error("[admin-data-sources] Error patching source:", error);
        return new Response(
          JSON.stringify({ error: "Failed to update source", code: "PATCH_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE - Remove data source
    if (req.method === "DELETE") {
      if (!sourceId || sourceId === "admin-data-sources") {
        return new Response(
          JSON.stringify({ error: "Source ID required", code: "MISSING_ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("data_sources")
        .delete()
        .eq("id", sourceId);

      if (error) {
        logger.error("[admin-data-sources] Error deleting source:", error);
        return new Response(
          JSON.stringify({ error: "Failed to delete source", code: "DELETE_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.info(`[admin-data-sources] Deleted source: ${sourceId}`);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error("[admin-data-sources] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
