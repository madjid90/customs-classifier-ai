import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";
import { corsHeaders, getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// TYPES
// ============================================================================

type KBSource = "omd" | "maroc" | "lois" | "dum";
type AmbiguityType = "multiple_codes" | "range" | "exclusion" | "note_explicative" | "format_error" | "other";

interface ImportRequest {
  source: KBSource;
  version_label: string;
  documents: DocumentInput[];
  chunk_size?: number;
  chunk_overlap?: number;
  clear_existing?: boolean;
  ingestion_id?: string;
}

interface DocumentInput {
  doc_id: string;
  title?: string;
  content: string;
  ref_prefix?: string;
}

interface ChunkResult {
  doc_id: string;
  chunks_created: number;
}

interface Ambiguity {
  source_row: string;
  ambiguity_type: AmbiguityType;
  description: string;
}

interface ImportResponse {
  success: boolean;
  source: KBSource;
  version_label: string;
  documents_processed: number;
  total_chunks_created: number;
  results: ChunkResult[];
  errors: string[];
  ambiguities: Ambiguity[];
}

// ============================================================================
// AMBIGUITY DETECTION & LOGGING
// ============================================================================

function detectAmbiguities(content: string, docId: string): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];

  // Détecter les codes multiples dans une même cellule/ligne
  const multipleCodesPattern = /(\d{4,10})\s*[,;\/]\s*(\d{4,10})/g;
  let match;
  while ((match = multipleCodesPattern.exec(content)) !== null) {
    ambiguities.push({
      source_row: match[0].substring(0, 200),
      ambiguity_type: "multiple_codes",
      description: `Codes multiples détectés: ${match[1]} et ${match[2]} dans ${docId}`,
    });
  }

  // Détecter les ranges de codes (ex: 01012100-01012900)
  const rangePattern = /(\d{6,10})\s*[-–]\s*(\d{6,10})/g;
  while ((match = rangePattern.exec(content)) !== null) {
    const start = match[1];
    const end = match[2];
    // Vérifier que c'est bien un range (même préfixe, différent suffix)
    if (start.substring(0, 4) === end.substring(0, 4) && start !== end) {
      ambiguities.push({
        source_row: match[0].substring(0, 200),
        ambiguity_type: "range",
        description: `Range de codes détecté: ${start} à ${end} dans ${docId}`,
      });
    }
  }

  // Détecter les exclusions (ex: "à l'exclusion de", "sauf", "except")
  const exclusionPatterns = [
    /à\s+l['']exclusion\s+de\s+([^.]+)/gi,
    /sauf\s+([^.]+)/gi,
    /excepté\s+([^.]+)/gi,
    /non\s+compris\s+([^.]+)/gi,
    /à\s+l['']exception\s+de\s+([^.]+)/gi,
  ];

  for (const pattern of exclusionPatterns) {
    while ((match = pattern.exec(content)) !== null) {
      ambiguities.push({
        source_row: match[0].substring(0, 200),
        ambiguity_type: "exclusion",
        description: `Clause d'exclusion: "${match[0].substring(0, 100)}" dans ${docId}`,
      });
    }
  }

  // Détecter les notes explicatives
  const notePatterns = [
    /Note\s*\d*\s*[:.\-]\s*([^.]+)/gi,
    /N\.B\.\s*[:.\-]?\s*([^.]+)/gi,
    /Remarque\s*[:.\-]\s*([^.]+)/gi,
  ];

  for (const pattern of notePatterns) {
    while ((match = pattern.exec(content)) !== null) {
      ambiguities.push({
        source_row: match[0].substring(0, 200),
        ambiguity_type: "note_explicative",
        description: `Note explicative: "${match[0].substring(0, 100)}" dans ${docId}`,
      });
    }
  }

  return ambiguities;
}

async function logAmbiguities(
  supabase: any,
  ambiguities: Ambiguity[],
  ingestionId?: string
): Promise<void> {
  if (ambiguities.length === 0 || !ingestionId) return;

  const records = ambiguities.slice(0, 100).map(a => ({
    ingestion_id: ingestionId,
    source_row: a.source_row.substring(0, 1000),
    ambiguity_type: a.ambiguity_type,
    description: a.description.substring(0, 2000),
  }));

  const { error } = await supabase.from("ingestion_ambiguities").insert(records);
  if (error) {
    console.error("[import-kb] Error logging ambiguities:", error);
  }
}

// ============================================================================
// HS CODE RANGE EXPANSION
// ============================================================================

function expandHSCodeRange(start: string, end: string): string[] {
  // Normaliser à 10 chiffres
  const startClean = start.replace(/\D/g, '').padEnd(10, '0').substring(0, 10);
  const endClean = end.replace(/\D/g, '').padEnd(10, '0').substring(0, 10);
  
  // Trouver le préfixe commun
  let commonPrefix = '';
  for (let i = 0; i < 10; i++) {
    if (startClean[i] === endClean[i]) {
      commonPrefix += startClean[i];
    } else {
      break;
    }
  }
  
  // Si pas de préfixe commun ou range trop large, retourner juste les bornes
  if (commonPrefix.length < 4) {
    return [startClean, endClean];
  }
  
  // Calculer les codes intermédiaires (limité à 100 pour éviter explosion)
  const codes: string[] = [];
  const startNum = parseInt(startClean.substring(commonPrefix.length) || '0');
  const endNum = parseInt(endClean.substring(commonPrefix.length) || '0');
  
  const step = Math.max(1, Math.floor((endNum - startNum) / 100));
  
  for (let i = startNum; i <= endNum && codes.length < 100; i += step) {
    const suffix = i.toString().padStart(10 - commonPrefix.length, '0');
    codes.push(commonPrefix + suffix);
  }
  
  // S'assurer que le dernier code est inclus
  if (codes[codes.length - 1] !== endClean) {
    codes.push(endClean);
  }
  
  return codes;
}

// ============================================================================
// TEXT CHUNKING

interface Chunk {
  text: string;
  ref: string;
  start_char: number;
  end_char: number;
}

function chunkText(
  content: string,
  docId: string,
  refPrefix: string,
  chunkSize = 1000,
  chunkOverlap = 200
): Chunk[] {
  const chunks: Chunk[] = [];
  
  // Nettoyer le contenu
  const cleanContent = content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/ +/g, " ")
    .trim();

  if (cleanContent.length === 0) {
    return [];
  }

  // Stratégie de découpage intelligent
  // 1. D'abord par sections (titres, articles)
  // 2. Puis par paragraphes
  // 3. Enfin par phrases si nécessaire

  const sectionPatterns = [
    /^(#{1,3}\s+.+)$/gm,                          // Markdown headers
    /^(Article\s+\d+[\.\-]?\s*.*)$/gim,           // Articles de loi
    /^(Chapitre\s+[IVXLCDM\d]+[\.\-]?\s*.*)$/gim, // Chapitres
    /^(Section\s+[IVXLCDM\d]+[\.\-]?\s*.*)$/gim,  // Sections
    /^(\d{2}[\.\d]*\s+.+)$/gm,                    // Codes HS (ex: 84.71)
    /^(Note\s+\d+[\.\-]?\s*.*)$/gim,              // Notes
  ];

  // Identifier les sections
  interface Section {
    title: string;
    content: string;
    startIndex: number;
  }

  const sections: Section[] = [];
  let lastIndex = 0;
  let currentTitle = refPrefix || docId;

  // Trouver toutes les sections
  const allMatches: { index: number; title: string }[] = [];
  
  for (const pattern of sectionPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(cleanContent)) !== null) {
      allMatches.push({ index: match.index, title: match[1].trim() });
    }
  }

  // Trier par position
  allMatches.sort((a, b) => a.index - b.index);

  // Créer les sections
  for (let i = 0; i < allMatches.length; i++) {
    const match = allMatches[i];
    const nextIndex = allMatches[i + 1]?.index ?? cleanContent.length;
    
    // Ajouter le contenu avant cette section
    if (match.index > lastIndex) {
      sections.push({
        title: currentTitle,
        content: cleanContent.slice(lastIndex, match.index).trim(),
        startIndex: lastIndex,
      });
    }
    
    currentTitle = `${refPrefix ? refPrefix + " > " : ""}${match.title}`;
    lastIndex = match.index;
  }

  // Ajouter le reste
  if (lastIndex < cleanContent.length) {
    sections.push({
      title: currentTitle,
      content: cleanContent.slice(lastIndex).trim(),
      startIndex: lastIndex,
    });
  }

  // Si pas de sections trouvées, traiter tout comme une section
  if (sections.length === 0) {
    sections.push({
      title: refPrefix || docId,
      content: cleanContent,
      startIndex: 0,
    });
  }

  // Découper chaque section en chunks
  let chunkIndex = 0;
  
  for (const section of sections) {
    if (section.content.length === 0) continue;

    if (section.content.length <= chunkSize) {
      // Section assez petite, un seul chunk
      chunks.push({
        text: section.content,
        ref: section.title,
        start_char: section.startIndex,
        end_char: section.startIndex + section.content.length,
      });
      chunkIndex++;
    } else {
      // Découper par paragraphes d'abord
      const paragraphs = section.content.split(/\n\n+/);
      let currentChunk = "";
      let chunkStart = section.startIndex;
      let localOffset = 0;

      for (const para of paragraphs) {
        if (currentChunk.length + para.length + 2 <= chunkSize) {
          currentChunk += (currentChunk ? "\n\n" : "") + para;
        } else {
          // Sauvegarder le chunk actuel
          if (currentChunk.length > 0) {
            chunks.push({
              text: currentChunk,
              ref: `${section.title} [${chunkIndex + 1}]`,
              start_char: chunkStart,
              end_char: chunkStart + currentChunk.length,
            });
            chunkIndex++;
          }
          
          // Si le paragraphe est trop long, le découper par phrases
          if (para.length > chunkSize) {
            const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
            currentChunk = "";
            
            for (const sentence of sentences) {
              if (currentChunk.length + sentence.length <= chunkSize) {
                currentChunk += sentence;
              } else {
                if (currentChunk.length > 0) {
                  chunks.push({
                    text: currentChunk,
                    ref: `${section.title} [${chunkIndex + 1}]`,
                    start_char: section.startIndex + localOffset,
                    end_char: section.startIndex + localOffset + currentChunk.length,
                  });
                  chunkIndex++;
                  localOffset += currentChunk.length;
                }
                currentChunk = sentence;
              }
            }
          } else {
            currentChunk = para;
            chunkStart = section.startIndex + localOffset;
          }
        }
        localOffset += para.length + 2;
      }

      // Dernier chunk de la section
      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk,
          ref: `${section.title} [${chunkIndex + 1}]`,
          start_char: chunkStart,
          end_char: chunkStart + currentChunk.length,
        });
        chunkIndex++;
      }
    }
  }

  // Ajouter overlap si configuré
  if (chunkOverlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const overlapText = prevChunk.text.slice(-chunkOverlap);
      if (overlapText.length > 50) {
        // Trouver un point de coupure naturel
        const lastSpace = overlapText.lastIndexOf(" ");
        const overlap = lastSpace > 0 ? overlapText.slice(lastSpace + 1) : overlapText;
        chunks[i].text = `...${overlap} ${chunks[i].text}`;
      }
    }
  }

  return chunks;
}

// ============================================================================
// BULK IMPORT FUNCTIONS
// ============================================================================

async function importOMDNotes(
  supabase: any,
  documents: DocumentInput[],
  versionLabel: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<{ results: ChunkResult[]; errors: string[] }> {
  const results: ChunkResult[] = [];
  const errors: string[] = [];

  for (const doc of documents) {
    try {
      // Parser le contenu OMD (format attendu: notes explicatives HS)
      const chunks = chunkText(doc.content, doc.doc_id, doc.ref_prefix || doc.doc_id, chunkSize, chunkOverlap);
      
      if (chunks.length === 0) {
        errors.push(`Document ${doc.doc_id}: Aucun contenu à importer`);
        continue;
      }

      // Insérer les chunks
      const chunkRecords = chunks.map(chunk => ({
        source: "omd" as const,
        doc_id: doc.doc_id,
        ref: chunk.ref,
        text: chunk.text,
        version_label: versionLabel,
      }));

      const { error: insertError } = await supabase
        .from("kb_chunks")
        .insert(chunkRecords);

      if (insertError) {
        errors.push(`Document ${doc.doc_id}: ${insertError.message}`);
      } else {
        results.push({ doc_id: doc.doc_id, chunks_created: chunks.length });
      }

      // Aussi insérer dans hs_omd_notes si format approprié
      const hsMatch = doc.doc_id.match(/^(\d{2,8})$/);
      if (hsMatch) {
        const hsCode = hsMatch[1];
        const hsLevel = hsCode.length <= 2 ? "chapter" : hsCode.length <= 4 ? "heading" : "subheading";
        
        await supabase.from("hs_omd_notes").upsert({
          hs_code: hsCode,
          hs_level: hsLevel,
          ref: doc.ref_prefix || `Note ${hsCode}`,
          text: doc.content,
          version_label: versionLabel,
        }, { onConflict: "hs_code,version_label" });
      }

    } catch (e) {
      errors.push(`Document ${doc.doc_id}: ${e instanceof Error ? e.message : "Erreur inconnue"}`);
    }
  }

  return { results, errors };
}

async function importFinanceLaws(
  supabase: any,
  documents: DocumentInput[],
  versionLabel: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<{ results: ChunkResult[]; errors: string[] }> {
  const results: ChunkResult[] = [];
  const errors: string[] = [];

  for (const doc of documents) {
    try {
      const chunks = chunkText(doc.content, doc.doc_id, doc.ref_prefix || doc.doc_id, chunkSize, chunkOverlap);
      
      if (chunks.length === 0) {
        errors.push(`Document ${doc.doc_id}: Aucun contenu à importer`);
        continue;
      }

      // Insérer dans kb_chunks
      const chunkRecords = chunks.map(chunk => ({
        source: "lois" as const,
        doc_id: doc.doc_id,
        ref: chunk.ref,
        text: chunk.text,
        version_label: versionLabel,
      }));

      const { error: insertError } = await supabase
        .from("kb_chunks")
        .insert(chunkRecords);

      if (insertError) {
        errors.push(`Document ${doc.doc_id}: ${insertError.message}`);
      } else {
        results.push({ doc_id: doc.doc_id, chunks_created: chunks.length });
      }

      // Extraire les articles et les stocker dans finance_law_articles
      const articlePattern = /Article\s+(\d+[\.\-]?\d*)\s*[:\-]?\s*([\s\S]*?)(?=Article\s+\d|$)/gi;
      let match;
      
      while ((match = articlePattern.exec(doc.content)) !== null) {
        const articleRef = `Article ${match[1]}`;
        const articleText = match[2].trim();
        
        if (articleText.length > 10) {
          // Extraire des mots-clés
          const keywords = articleText
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 4)
            .slice(0, 20);

          await supabase.from("finance_law_articles").upsert({
            ref: articleRef,
            text: articleText.slice(0, 10000),
            version_label: versionLabel,
            title: doc.title || doc.doc_id,
            keywords: keywords,
          }, { onConflict: "ref,version_label" });
        }
      }

    } catch (e) {
      errors.push(`Document ${doc.doc_id}: ${e instanceof Error ? e.message : "Erreur inconnue"}`);
    }
  }

  return { results, errors };
}

async function importMarocTariff(
  supabase: any,
  documents: DocumentInput[],
  versionLabel: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<{ results: ChunkResult[]; errors: string[] }> {
  const results: ChunkResult[] = [];
  const errors: string[] = [];

  for (const doc of documents) {
    try {
      const chunks = chunkText(doc.content, doc.doc_id, doc.ref_prefix || doc.doc_id, chunkSize, chunkOverlap);
      
      if (chunks.length === 0) {
        errors.push(`Document ${doc.doc_id}: Aucun contenu à importer`);
        continue;
      }

      const chunkRecords = chunks.map(chunk => ({
        source: "maroc" as const,
        doc_id: doc.doc_id,
        ref: chunk.ref,
        text: chunk.text,
        version_label: versionLabel,
      }));

      const { error: insertError } = await supabase
        .from("kb_chunks")
        .insert(chunkRecords);

      if (insertError) {
        errors.push(`Document ${doc.doc_id}: ${insertError.message}`);
      } else {
        results.push({ doc_id: doc.doc_id, chunks_created: chunks.length });
      }

    } catch (e) {
      errors.push(`Document ${doc.doc_id}: ${e instanceof Error ? e.message : "Erreur inconnue"}`);
    }
  }

  return { results, errors };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Vérifier auth (admin requis)
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Vérifier rôle admin
      const { data: hasAdmin } = await supabase.rpc("has_role", { 
        _user_id: user.id, 
        _role: "admin" 
      });

      if (!hasAdmin) {
        return new Response(
          JSON.stringify({ error: "Admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const body: ImportRequest = await req.json();
    const { 
      source, 
      version_label, 
      documents, 
      chunk_size = 1000, 
      chunk_overlap = 200,
      clear_existing = false 
    } = body;

    console.log(`Import KB: source=${source}, version=${version_label}, docs=${documents.length}`);

    // Validation
    if (!source || !["omd", "maroc", "lois", "dum"].includes(source)) {
      return new Response(
        JSON.stringify({ error: "Invalid source. Must be: omd, maroc, lois, or dum" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!version_label) {
      return new Response(
        JSON.stringify({ error: "version_label is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one document is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Effacer les données existantes si demandé
    if (clear_existing) {
      console.log(`Clearing existing chunks for source=${source}, version=${version_label}`);
      await supabase
        .from("kb_chunks")
        .delete()
        .eq("source", source)
        .eq("version_label", version_label);
    }

    // Importer selon la source
    let importResult: { results: ChunkResult[]; errors: string[] };

    switch (source) {
      case "omd":
        importResult = await importOMDNotes(supabase, documents, version_label, chunk_size, chunk_overlap);
        break;
      case "lois":
        importResult = await importFinanceLaws(supabase, documents, version_label, chunk_size, chunk_overlap);
        break;
      case "maroc":
        importResult = await importMarocTariff(supabase, documents, version_label, chunk_size, chunk_overlap);
        break;
      case "dum":
        // Pour DUM, utiliser le même traitement que maroc
        importResult = await importMarocTariff(supabase, documents, version_label, chunk_size, chunk_overlap);
        break;
      default:
        importResult = { results: [], errors: [`Source non supportée: ${source}`] };
    }

    const totalChunks = importResult.results.reduce((sum, r) => sum + r.chunks_created, 0);

    // Détecter les ambiguïtés dans tous les documents
    const allAmbiguities: Ambiguity[] = [];
    for (const doc of documents) {
      const docAmbiguities = detectAmbiguities(doc.content, doc.doc_id);
      allAmbiguities.push(...docAmbiguities);
    }

    // Logger les ambiguïtés si ingestion_id fourni
    if (body.ingestion_id && allAmbiguities.length > 0) {
      await logAmbiguities(supabase, allAmbiguities, body.ingestion_id);
    }

    const response: ImportResponse = {
      success: importResult.errors.length === 0,
      source,
      version_label,
      documents_processed: importResult.results.length,
      total_chunks_created: totalChunks,
      results: importResult.results,
      errors: importResult.errors,
      ambiguities: allAmbiguities.slice(0, 50), // Limiter la réponse
    };

    console.log(`Import complete: ${totalChunks} chunks, ${importResult.errors.length} errors, ${allAmbiguities.length} ambiguities`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Import KB error:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        ambiguities: []
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
