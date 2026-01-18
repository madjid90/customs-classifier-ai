import { supabase } from "@/integrations/supabase/client";

export type KBSource = "omd" | "maroc" | "lois" | "dum";

export interface DocumentInput {
  doc_id: string;
  title?: string;
  content: string;
  ref_prefix?: string;
}

export interface ImportKBRequest {
  source: KBSource;
  version_label: string;
  documents: DocumentInput[];
  chunk_size?: number;
  chunk_overlap?: number;
  clear_existing?: boolean;
}

export interface ChunkResult {
  doc_id: string;
  chunks_created: number;
}

export interface Ambiguity {
  source_row: string;
  ambiguity_type: "multiple_codes" | "range" | "exclusion" | "note_explicative" | "format_error" | "other";
  description: string;
}

export interface ImportKBResponse {
  success: boolean;
  source: KBSource;
  version_label: string;
  documents_processed: number;
  total_chunks_created: number;
  results: ChunkResult[];
  errors: string[];
  ambiguities: Ambiguity[];
}

export interface EmbeddingStats {
  total_chunks: number;
  with_embeddings: number;
  without_embeddings: number;
  percentage_complete: number;
}

export interface EmbeddingBatchResult {
  success: boolean;
  processed: number;
  saved: number;
  errors: number;
  remaining: number;
}

export interface KBStats {
  total_chunks: number;
  by_source: Record<KBSource, number>;
  by_version: Record<string, number>;
  recent_imports: { version_label: string; created_at: string; count: number }[];
  embeddings?: EmbeddingStats;
}

// ============================================================================
// EMBEDDING FUNCTIONS
// ============================================================================

export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  const { data, error } = await supabase.functions.invoke("generate-embeddings", {
    body: { mode: "stats" },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.stats;
}

export async function generateEmbeddingsBatch(batchSize = 50): Promise<EmbeddingBatchResult> {
  const { data, error } = await supabase.functions.invoke("generate-embeddings", {
    body: { mode: "batch", batch_size: batchSize },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function generateSingleEmbedding(text: string, chunkId?: string): Promise<number[]> {
  const { data, error } = await supabase.functions.invoke("generate-embeddings", {
    body: { mode: "single", text, chunk_id: chunkId },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.embedding;
}

// ============================================================================
// KB IMPORT FUNCTIONS
// ============================================================================

export async function importKBDocuments(request: ImportKBRequest): Promise<ImportKBResponse> {
  const { data, error } = await supabase.functions.invoke("import-kb", {
    body: request,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getKBStats(): Promise<KBStats> {
  // Get total count
  const { count: totalChunks } = await supabase
    .from("kb_chunks")
    .select("*", { count: "exact", head: true });

  // Get counts by source
  const sources: KBSource[] = ["omd", "maroc", "lois", "dum"];
  const bySource: Record<KBSource, number> = { omd: 0, maroc: 0, lois: 0, dum: 0 };
  
  for (const source of sources) {
    const { count } = await supabase
      .from("kb_chunks")
      .select("*", { count: "exact", head: true })
      .eq("source", source);
    bySource[source] = count || 0;
  }

  // Get counts by version
  const { data: versions } = await supabase
    .from("kb_chunks")
    .select("version_label")
    .limit(1000);

  const byVersion: Record<string, number> = {};
  for (const row of versions || []) {
    byVersion[row.version_label] = (byVersion[row.version_label] || 0) + 1;
  }

  // Get recent imports (approximation via created_at)
  const { data: recent } = await supabase
    .from("kb_chunks")
    .select("version_label, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const recentMap = new Map<string, { version_label: string; created_at: string; count: number }>();
  for (const row of recent || []) {
    const existing = recentMap.get(row.version_label);
    if (existing) {
      existing.count++;
    } else {
      recentMap.set(row.version_label, {
        version_label: row.version_label,
        created_at: row.created_at,
        count: 1,
      });
    }
  }

  return {
    total_chunks: totalChunks || 0,
    by_source: bySource,
    by_version: byVersion,
    recent_imports: [...recentMap.values()].slice(0, 10),
  };
}

export async function searchKBChunks(
  query: string,
  sources?: KBSource[],
  limit = 20
): Promise<Array<{
  id: string;
  source: KBSource;
  doc_id: string;
  ref: string;
  text: string;
  version_label: string;
}>> {
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    return [];
  }

  let queryBuilder = supabase
    .from("kb_chunks")
    .select("id, source, doc_id, ref, text, version_label")
    .or(keywords.slice(0, 5).map(k => `text.ilike.%${k}%`).join(","))
    .limit(limit);

  if (sources && sources.length > 0) {
    queryBuilder = queryBuilder.in("source", sources);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    console.error("KB search error:", error);
    return [];
  }

  return (data || []) as Array<{
    id: string;
    source: KBSource;
    doc_id: string;
    ref: string;
    text: string;
    version_label: string;
  }>;
}

export async function deleteKBChunks(
  source?: KBSource,
  versionLabel?: string
): Promise<{ deleted: number }> {
  // First count the items to delete
  let countQuery = supabase.from("kb_chunks").select("id", { count: "exact", head: true });
  
  if (source) {
    countQuery = countQuery.eq("source", source);
  }
  if (versionLabel) {
    countQuery = countQuery.eq("version_label", versionLabel);
  }
  if (!source && !versionLabel) {
    countQuery = countQuery.neq("id", "00000000-0000-0000-0000-000000000000");
  }
  
  const { count } = await countQuery;
  
  // Then delete
  let deleteQuery = supabase.from("kb_chunks").delete();
  
  if (source) {
    deleteQuery = deleteQuery.eq("source", source);
  }
  if (versionLabel) {
    deleteQuery = deleteQuery.eq("version_label", versionLabel);
  }
  if (!source && !versionLabel) {
    deleteQuery = deleteQuery.neq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { error } = await deleteQuery;

  if (error) {
    throw new Error(error.message);
  }

  return { deleted: count || 0 };
}

// Helper to parse text files
export function parseTextFile(content: string): DocumentInput[] {
  // Try to detect document structure
  const documents: DocumentInput[] = [];
  
  // Check for markdown-style documents with frontmatter or headers
  const docSections = content.split(/(?=^#{1,2}\s+)/gm).filter(s => s.trim());
  
  if (docSections.length > 1) {
    // Multiple documents detected
    for (let i = 0; i < docSections.length; i++) {
      const section = docSections[i].trim();
      const titleMatch = section.match(/^#{1,2}\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : `Document ${i + 1}`;
      const docContent = titleMatch ? section.slice(titleMatch[0].length).trim() : section;
      
      documents.push({
        doc_id: title.toLowerCase().replace(/\s+/g, "_").slice(0, 50),
        title,
        content: docContent,
        ref_prefix: title,
      });
    }
  } else {
    // Single document
    documents.push({
      doc_id: "document_1",
      title: "Document importé",
      content: content.trim(),
    });
  }
  
  return documents;
}

// Helper to parse CSV/structured data
export function parseCSVToDocuments(
  rows: Record<string, string>[],
  docIdColumn: string,
  contentColumn: string,
  titleColumn?: string,
  refColumn?: string
): DocumentInput[] {
  return rows
    .filter(row => row[docIdColumn] && row[contentColumn])
    .map(row => ({
      doc_id: row[docIdColumn],
      title: titleColumn ? row[titleColumn] : undefined,
      content: row[contentColumn],
      ref_prefix: refColumn ? row[refColumn] : undefined,
    }));
}
