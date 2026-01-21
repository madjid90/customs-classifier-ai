import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  createBackgroundTask, 
  updateTaskProgress, 
  completeTask, 
  failTask 
} from "../_shared/background-tasks.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL_REASONING") || "gpt-4o-mini";

// ============================================================================
// TYPES
// ============================================================================

interface HSUpdate {
  code_10: string;
  field: "taxes" | "label_fr" | "unit" | "active";
  old_value: string | null;
  new_value: string;
  source_ref: string;
  effective_date?: string;
}

interface SyncResult {
  success: boolean;
  laws_analyzed: number;
  updates_found: number;
  updates_applied: number;
  errors: string[];
  updates: HSUpdate[];
}

// ============================================================================
// OPENAI EXTRACTION
// ============================================================================

async function extractHSUpdatesFromLaw(lawText: string, lawRef: string): Promise<HSUpdate[]> {
  if (!OPENAI_API_KEY) {
    console.warn("[sync-hs] No OpenAI API key, skipping AI extraction");
    return extractHSUpdatesRegex(lawText, lawRef);
  }

  const systemPrompt = `Tu es un expert en législation douanière marocaine.
Analyse le texte de loi de finances et extrait TOUTES les modifications qui affectent les codes HS.

Pour chaque modification trouvée, retourne:
- code_10: le code HS à 10 chiffres (ou 4-6 si c'est une position/sous-position)
- field: le champ modifié ("taxes", "label_fr", "unit", "active")
- new_value: la nouvelle valeur (pour taxes, format JSON: {"droit_import": 25, "tva": 20})
- source_ref: la référence exacte dans le texte (ex: "Article 3, alinéa 2")
- effective_date: date d'entrée en vigueur si mentionnée (format YYYY-MM-DD)

Types de modifications à chercher:
1. Modification de droits de douane (DD, DI)
2. Modification de TVA
3. Création de nouveaux codes
4. Suppression/désactivation de codes
5. Modification de libellés
6. Exonérations ou régimes spéciaux

IMPORTANT: Ne retourne QUE les modifications explicites avec des codes HS identifiables.
Retourne un JSON: { "updates": [...] }`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Loi: ${lawRef}\n\n${lawText.slice(0, 15000)}` }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("[sync-hs] OpenAI error:", response.status);
      return extractHSUpdatesRegex(lawText, lawRef);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    
    const updates = (parsed.updates || []).map((u: any) => ({
      code_10: normalizeHSCode(u.code_10 || u.code || ""),
      field: u.field || "taxes",
      old_value: null,
      new_value: typeof u.new_value === "object" ? JSON.stringify(u.new_value) : String(u.new_value || ""),
      source_ref: u.source_ref || lawRef,
      effective_date: u.effective_date || undefined,
    })).filter((u: HSUpdate) => u.code_10 && u.new_value);

    console.log(`[sync-hs] AI extracted ${updates.length} updates from ${lawRef}`);
    return updates;
    
  } catch (e) {
    console.error("[sync-hs] AI extraction error:", e);
    return extractHSUpdatesRegex(lawText, lawRef);
  }
}

// ============================================================================
// REGEX FALLBACK EXTRACTION
// ============================================================================

function extractHSUpdatesRegex(lawText: string, lawRef: string): HSUpdate[] {
  const updates: HSUpdate[] = [];
  
  // Pattern pour les modifications de droits
  const taxPatterns = [
    /(?:position|code|sous-position)\s*(\d{4}[\.\s]?\d{0,2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\s*[:\-]?\s*(?:droit|DD|DI|TVA)\s*[=:]?\s*(\d+(?:,\d+)?)\s*%/gi,
    /(\d{4}[\.\s]\d{2}(?:[\.\s]\d{2}){0,2})\s*[:\-\|]\s*(\d+(?:,\d+)?)\s*%/gi,
  ];
  
  for (const pattern of taxPatterns) {
    let match;
    while ((match = pattern.exec(lawText)) !== null) {
      const code = normalizeHSCode(match[1]);
      const rate = match[2].replace(",", ".");
      
      if (code.length >= 4) {
        updates.push({
          code_10: code,
          field: "taxes",
          old_value: null,
          new_value: JSON.stringify({ droit_import: parseFloat(rate) }),
          source_ref: lawRef,
        });
      }
    }
  }
  
  // Pattern pour les exonérations
  const exemptPatterns = [
    /exonér[ée]s?\s*(?:de|du)\s*(?:droit|TVA)[^.]*?(\d{4}[\.\s]?\d{0,2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})/gi,
    /(\d{4}[\.\s]\d{2}(?:[\.\s]\d{2}){0,2})[^.]*?exonér[ée]/gi,
  ];
  
  for (const pattern of exemptPatterns) {
    let match;
    while ((match = pattern.exec(lawText)) !== null) {
      const code = normalizeHSCode(match[1]);
      if (code.length >= 4) {
        updates.push({
          code_10: code,
          field: "taxes",
          old_value: null,
          new_value: JSON.stringify({ exonere: true, droit_import: 0 }),
          source_ref: `${lawRef} (exonération)`,
        });
      }
    }
  }
  
  console.log(`[sync-hs] Regex extracted ${updates.length} updates from ${lawRef}`);
  return updates;
}

function normalizeHSCode(code: string): string {
  const cleaned = code.replace(/[\.\s\-]/g, "");
  if (cleaned.length < 4 || !/^\d+$/.test(cleaned)) return "";
  return cleaned.padEnd(10, "0").substring(0, 10);
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function applyHSUpdates(
  supabase: any,
  updates: HSUpdate[]
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;
  
  for (const update of updates) {
    try {
      // Vérifier si le code existe
      const { data: existing } = await supabase
        .from("hs_codes")
        .select("code_10, taxes, label_fr, unit")
        .eq("code_10", update.code_10)
        .single();
      
      if (!existing) {
        // Créer le code s'il n'existe pas (pour les nouvelles positions)
        if (update.field === "taxes") {
          const taxData = JSON.parse(update.new_value);
          const { error: insertError } = await supabase.from("hs_codes").insert({
            code_10: update.code_10,
            code_6: update.code_10.substring(0, 6),
            code_4: update.code_10.substring(0, 4),
            chapter_2: update.code_10.substring(0, 2),
            label_fr: `Position ${update.code_10} (ajoutée par ${update.source_ref})`,
            taxes: taxData,
            active: true,
            active_version_label: update.effective_date || new Date().toISOString().split("T")[0],
          });
          
          if (insertError) {
            errors.push(`Insert ${update.code_10}: ${insertError.message}`);
          } else {
            applied++;
            console.log(`[sync-hs] Created new HS code: ${update.code_10}`);
          }
        }
        continue;
      }
      
      // Stocker l'ancienne valeur
      update.old_value = existing[update.field] ? JSON.stringify(existing[update.field]) : null;
      
      // Appliquer la mise à jour
      const updateData: Record<string, any> = {};
      
      if (update.field === "taxes") {
        const newTaxes = JSON.parse(update.new_value);
        updateData.taxes = { ...(existing.taxes || {}), ...newTaxes };
      } else if (update.field === "active") {
        updateData.active = update.new_value === "true";
      } else {
        updateData[update.field] = update.new_value;
      }
      
      // Ajouter les métadonnées de mise à jour
      updateData.enrichment = {
        ...(existing.enrichment || {}),
        last_law_update: {
          source_ref: update.source_ref,
          updated_at: new Date().toISOString(),
          effective_date: update.effective_date,
        },
      };
      
      const { error: updateError } = await supabase
        .from("hs_codes")
        .update(updateData)
        .eq("code_10", update.code_10);
      
      if (updateError) {
        errors.push(`Update ${update.code_10}: ${updateError.message}`);
      } else {
        applied++;
        console.log(`[sync-hs] Updated ${update.code_10}.${update.field}`);
      }
      
    } catch (e) {
      errors.push(`${update.code_10}: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }
  
  return { applied, errors };
}

async function logSyncHistory(
  supabase: any,
  result: SyncResult,
  versionLabel?: string
): Promise<void> {
  try {
    await supabase.from("hs_sync_history").insert({
      version_label: versionLabel || "manual",
      laws_analyzed: result.laws_analyzed,
      updates_found: result.updates_found,
      updates_applied: result.updates_applied,
      details: {
        updates: result.updates.slice(0, 100),
        errors: result.errors.slice(0, 50),
      },
    });
  } catch (e) {
    console.error("[sync-hs] Failed to log sync history:", e);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Authenticate with custom JWT
    const authResult = await authenticateRequest(req, { requireRole: ["admin", "manager"] });
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user } = authResult.data;
    const supabase = createServiceClient();
    
    // Parser les options
    const body = await req.json().catch(() => ({}));
    const {
      version_label,
      dry_run = false,
      limit = 50,
    } = body;
    
    console.log(`[sync-hs] Starting sync - version: ${version_label || "all"}, dry_run: ${dry_run}`);
    
    // Récupérer les lois de finance non encore analysées ou récentes
    let query = supabase
      .from("kb_chunks")
      .select("id, doc_id, ref, text, version_label, metadata")
      .eq("source", "lois")
      .order("created_at", { ascending: false })
      .limit(limit);
    
    if (version_label) {
      query = query.eq("version_label", version_label);
    }
    
    const { data: lawChunks, error: fetchError } = await query;
    
    if (fetchError) {
      throw new Error(`Failed to fetch law chunks: ${fetchError.message}`);
    }
    
    if (!lawChunks || lawChunks.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          laws_analyzed: 0,
          updates_found: 0,
          updates_applied: 0,
          message: "No law documents to analyze",
          errors: [],
          updates: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Regrouper par document pour éviter les doublons
    const docGroups = new Map<string, { text: string; ref: string }>();
    for (const chunk of lawChunks) {
      const key = `${chunk.doc_id}-${chunk.version_label}`;
      if (!docGroups.has(key)) {
        docGroups.set(key, { text: chunk.text, ref: chunk.ref });
      } else {
        docGroups.get(key)!.text += "\n\n" + chunk.text;
      }
    }
    
    // Create background task for tracking
    const taskId = await createBackgroundTask(supabase, "sync_hs_laws", {
      itemsTotal: docGroups.size,
      createdBy: user.id,
    });
    
    // Analyser chaque document
    const allUpdates: HSUpdate[] = [];
    const allErrors: string[] = [];
    let docsProcessed = 0;
    
    for (const [docKey, doc] of docGroups) {
      try {
        const updates = await extractHSUpdatesFromLaw(doc.text, doc.ref);
        allUpdates.push(...updates);
        docsProcessed++;
        
        // Update progress
        if (taskId && docsProcessed % 2 === 0) {
          await updateTaskProgress(supabase, taskId, docsProcessed, docGroups.size);
        }
      } catch (e) {
        allErrors.push(`${docKey}: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }
    
    // Dédupliquer les mises à jour (garder la dernière pour chaque code/champ)
    const uniqueUpdates = new Map<string, HSUpdate>();
    for (const update of allUpdates) {
      const key = `${update.code_10}-${update.field}`;
      uniqueUpdates.set(key, update);
    }
    const deduplicatedUpdates = Array.from(uniqueUpdates.values());
    
    console.log(`[sync-hs] Found ${deduplicatedUpdates.length} unique updates from ${docGroups.size} documents`);
    
    // Appliquer les mises à jour (sauf si dry_run)
    let appliedCount = 0;
    if (!dry_run && deduplicatedUpdates.length > 0) {
      const { applied, errors } = await applyHSUpdates(supabase, deduplicatedUpdates);
      appliedCount = applied;
      allErrors.push(...errors);
    }
    
    const result: SyncResult = {
      success: true,
      laws_analyzed: docGroups.size,
      updates_found: deduplicatedUpdates.length,
      updates_applied: appliedCount,
      errors: allErrors,
      updates: deduplicatedUpdates.slice(0, 50),
    };
    
    // Complete task
    if (taskId) {
      if (allErrors.length > 0 && docsProcessed === 0) {
        await failTask(supabase, taskId, allErrors.join("; ").substring(0, 500), 0);
      } else {
        await completeTask(supabase, taskId, appliedCount, deduplicatedUpdates.length);
      }
    }
    
    // Logger l'historique
    if (!dry_run) {
      await logSyncHistory(supabase, result, version_label);
    }
    
    console.log(`[sync-hs] Sync complete: ${result.updates_applied}/${result.updates_found} applied`);
    
    return new Response(
      JSON.stringify({ ...result, task_id: taskId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (e) {
    console.error("[sync-hs] Error:", e);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: e instanceof Error ? e.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
