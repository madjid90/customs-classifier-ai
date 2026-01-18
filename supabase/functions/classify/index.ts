import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ClassifyRequest {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}

interface Alternative {
  code: string;
  reason: string;
  confidence: number;
}

interface EvidenceItem {
  source: "omd" | "maroc" | "lois" | "dum";
  doc_id: string;
  ref: string;
  excerpt: string;
}

interface NextQuestion {
  id: string;
  label: string;
  type: "yesno" | "select" | "text";
  options?: { value: string; label: string }[];
  required: boolean;
}

interface ClassifyResult {
  status: "NEED_INFO" | "DONE" | "ERROR" | "LOW_CONFIDENCE";
  recommended_code: string | null;
  confidence: number | null;
  confidence_level: "high" | "medium" | "low" | null;
  justification_short: string | null;
  alternatives: Alternative[];
  evidence: EvidenceItem[];
  next_question: NextQuestion | null;
  error_message: string | null;
  answers: Record<string, string>;
}

const SYSTEM_PROMPT = `Tu es un expert en classification douanière. Tu analyses les documents fournis (fiches techniques, factures, photos) pour déterminer le code SH (Système Harmonisé) à 10 chiffres d'un produit.

RÈGLES IMPORTANTES:
1. Analyse TOUS les documents fournis en détail
2. Base ta classification sur les caractéristiques techniques du produit
3. Utilise la nomenclature douanière internationale (SH) et marocaine
4. Fournis TOUJOURS des preuves documentaires pour justifier ta recommandation
5. Si tu manques d'informations, pose UNE question précise
6. Exprime ta confiance en pourcentage (0-100)

NIVEAUX DE CONFIANCE:
- high (>=85%): Classification certaine avec preuves solides
- medium (65-84%): Classification probable mais à vérifier
- low (<65%): Informations insuffisantes

FORMAT DE RÉPONSE (JSON strict):
{
  "status": "DONE" | "NEED_INFO" | "LOW_CONFIDENCE",
  "recommended_code": "XX.XX.XX.XX.XX" (10 chiffres) ou null,
  "confidence": 0-100 ou null,
  "justification_short": "Explication courte en 1-2 phrases",
  "alternatives": [
    {"code": "XX.XX.XX.XX.XX", "reason": "Raison alternative", "confidence": 0-100}
  ],
  "evidence": [
    {"source": "omd"|"maroc"|"lois"|"dum", "doc_id": "ID", "ref": "Section/Article", "excerpt": "Citation pertinente"}
  ],
  "next_question": {
    "id": "q_material" ou autre ID unique,
    "label": "Question précise",
    "type": "yesno"|"select"|"text",
    "options": [{"value": "val", "label": "Label"}] (si type=select),
    "required": true
  } ou null
}

SOURCES pour evidence.source:
- "omd": Nomenclature OMD/SH internationale
- "maroc": Tarif douanier marocain
- "lois": Lois et règlements douaniers
- "dum": Documents DUM de référence`;

function buildUserPrompt(request: ClassifyRequest, productName: string): string {
  let prompt = `PRODUIT À CLASSIFIER: ${productName}
TYPE D'OPÉRATION: ${request.context.type_import_export === "import" ? "Importation" : "Exportation"}
PAYS D'ORIGINE: ${request.context.origin_country}

`;

  if (request.file_urls.length > 0) {
    prompt += `DOCUMENTS FOURNIS (${request.file_urls.length} fichiers):
Les documents sont joints en tant qu'images à analyser.

`;
  }

  if (Object.keys(request.answers).length > 0) {
    prompt += `RÉPONSES AUX QUESTIONS PRÉCÉDENTES:
`;
    for (const [questionId, answer] of Object.entries(request.answers)) {
      prompt += `- ${questionId}: ${answer}
`;
    }
    prompt += "\n";
  }

  prompt += `Analyse ces informations et fournis ta recommandation de classification douanière au format JSON spécifié.`;

  return prompt;
}

async function callLovableAI(
  systemPrompt: string,
  userPrompt: string,
  imageUrls: string[]
): Promise<ClassifyResult> {
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  // Build content array with text and images
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: userPrompt },
  ];

  // Add images if provided
  for (const url of imageUrls) {
    content.push({
      type: "image_url",
      image_url: { url },
    });
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Lovable AI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add funds.");
    }
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const aiResponse = data.choices?.[0]?.message?.content || "";

  console.log("AI Response:", aiResponse);

  // Extract JSON from response
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse AI response as JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Determine confidence level
  let confidenceLevel: "high" | "medium" | "low" | null = null;
  if (parsed.confidence !== null && parsed.confidence !== undefined) {
    if (parsed.confidence >= 85) confidenceLevel = "high";
    else if (parsed.confidence >= 65) confidenceLevel = "medium";
    else confidenceLevel = "low";
  }

  // Normalize confidence to 0-1 range (OpenAPI standard)
  const rawConfidence = parsed.confidence ?? null;
  const normalizedConfidence = rawConfidence !== null 
    ? (rawConfidence > 1 ? rawConfidence / 100 : rawConfidence) 
    : null;

  return {
    status: parsed.status || "ERROR",
    recommended_code: parsed.recommended_code || null,
    confidence: normalizedConfidence,
    confidence_level: confidenceLevel,
    justification_short: parsed.justification_short || null,
    alternatives: (parsed.alternatives || []).map((alt: any) => ({
      ...alt,
      confidence: alt.confidence > 1 ? alt.confidence / 100 : alt.confidence,
    })),
    evidence: parsed.evidence || [],
    next_question: parsed.next_question || null,
    error_message: parsed.error_message || null,
    answers: {},
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Parse request
    const body: ClassifyRequest = await req.json();
    const { case_id, file_urls, answers, context } = body;

    console.log("Classify request:", { case_id, file_urls_count: file_urls.length, answers });

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get case details
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      console.error("Case not found:", caseError);
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log classify call
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_called",
      user_id: caseData.created_by,
      user_phone: "system",
      meta: { file_urls_count: file_urls.length, answers_count: Object.keys(answers).length },
    });

    // Build prompts and call AI
    const userPrompt = buildUserPrompt(body, caseData.product_name);
    
    let result: ClassifyResult;
    try {
      result = await callLovableAI(SYSTEM_PROMPT, userPrompt, file_urls);
      result.answers = answers;
    } catch (aiError) {
      console.error("AI classification error:", aiError);
      result = {
        status: "ERROR",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: null,
        alternatives: [],
        evidence: [],
        next_question: null,
        error_message: aiError instanceof Error ? aiError.message : "Classification failed",
        answers,
      };
    }

    // Save result to database
    const { error: insertError } = await supabase.from("classification_results").insert({
      case_id,
      status: result.status,
      recommended_code: result.recommended_code,
      confidence: result.confidence,
      confidence_level: result.confidence_level,
      justification_short: result.justification_short,
      alternatives: result.alternatives,
      evidence: result.evidence,
      next_question: result.next_question,
      error_message: result.error_message,
      answers: result.answers,
    });

    if (insertError) {
      console.error("Failed to save classification result:", insertError);
    }

    // Update case status based on result
    let newStatus = caseData.status;
    if (result.status === "DONE" && result.evidence.length > 0) {
      newStatus = "RESULT_READY";
      
      // Log result ready
      await supabase.from("audit_logs").insert({
        case_id,
        action: "result_ready",
        user_id: caseData.created_by,
        user_phone: "system",
        meta: { 
          recommended_code: result.recommended_code,
          confidence: result.confidence,
        },
      });
    } else if (result.status === "ERROR") {
      newStatus = "ERROR";
    }

    if (newStatus !== caseData.status) {
      await supabase
        .from("cases")
        .update({ status: newStatus })
        .eq("id", case_id);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Classify error:", error);
    return new Response(
      JSON.stringify({ 
        status: "ERROR",
        error_message: error instanceof Error ? error.message : "Unknown error",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: null,
        alternatives: [],
        evidence: [],
        next_question: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
