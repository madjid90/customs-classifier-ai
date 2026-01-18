import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient
} from "../_shared/auth.ts";
import {
  validateRequestBody,
  validatePathParam,
  ExportPdfRequestSchema,
  UUIDSchema,
} from "../_shared/validation.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user using centralized auth
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user, profile } = authResult.data;
    const supabase = createServiceClient();

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract case_id from URL path or body
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    let caseId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;
    
    // If not in path, try body with Zod validation
    if (!caseId || caseId === "export-pdf") {
      const validation = await validateRequestBody(req, ExportPdfRequestSchema, corsHeaders);
      if (!validation.success) {
        return validation.error;
      }
      caseId = validation.data.case_id;
    } else {
      // Validate path param with Zod
      const pathValidation = validatePathParam(caseId, "case_id", UUIDSchema, corsHeaders);
      if (!pathValidation.success) {
        return pathValidation.error;
      }
      caseId = pathValidation.data;
    }

    logger.info(`Generating PDF for case: ${caseId}`);

    // Get case details
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", caseId)
      .eq("company_id", profile.company_id)
      .single();

    if (caseError || !caseData) {
      logger.error("Case error:", caseError);
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if case is validated
    if (caseData.status !== "VALIDATED") {
      return new Response(
        JSON.stringify({ error: "Only validated cases can be exported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get classification result
    const { data: classificationData, error: classError } = await supabase
      .from("classification_results")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (classError || !classificationData) {
      logger.error("Classification error:", classError);
      return new Response(
        JSON.stringify({ error: "Classification result not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company name
    const { data: companyData } = await supabase
      .from("companies")
      .select("name")
      .eq("id", profile.company_id)
      .single();

    // Get attached files
    const { data: filesData } = await supabase
      .from("case_files")
      .select("filename, file_type, created_at")
      .eq("case_id", caseId);

    // Format HS code: XX.XX.XX.XX.XX
    const formatHsCode = (code: string | null): string => {
      if (!code) return "N/A";
      const cleaned = code.replace(/\D/g, "");
      if (cleaned.length < 10) return code;
      return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 4)}.${cleaned.slice(4, 6)}.${cleaned.slice(6, 8)}.${cleaned.slice(8, 10)}`;
    };

    // Generate HTML for PDF
    const html = generatePdfHtml({
      caseData,
      classificationData,
      companyName: companyData?.name || "N/A",
      files: filesData || [],
      formatHsCode,
    });

    // Log audit
    await supabase.from("audit_logs").insert({
      case_id: caseId,
      user_id: user.id,
      user_phone: profile.phone,
      action: "EXPORT",
      meta: { format: "pdf", timestamp: new Date().toISOString() },
    });

    logger.info(`PDF generated successfully for case: ${caseId}`);

    // Return HTML that can be printed as PDF
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });

  } catch (err) {
    logger.error("Export PDF error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});

interface PdfData {
  caseData: {
    id: string;
    product_name: string;
    type_import_export: string;
    origin_country: string;
    created_at: string;
    validated_at: string | null;
    status: string;
  };
  classificationData: {
    recommended_code: string | null;
    confidence: number | null;
    confidence_level: string | null;
    justification_short: string | null;
    alternatives: unknown[];
    evidence: unknown[];
    answers: Record<string, string>;
    created_at: string;
  };
  companyName: string;
  files: Array<{ filename: string; file_type: string; created_at: string }>;
  formatHsCode: (code: string | null) => string;
}

function generatePdfHtml(data: PdfData): string {
  const { caseData, classificationData, companyName, files, formatHsCode } = data;
  
  const alternatives = Array.isArray(classificationData.alternatives) 
    ? classificationData.alternatives as Array<{ code?: string; confidence?: number; reason?: string }>
    : [];
  
  const evidence = Array.isArray(classificationData.evidence) 
    ? classificationData.evidence as Array<{ text?: string } | string>
    : [];
  
  const answers = classificationData.answers && typeof classificationData.answers === "object"
    ? classificationData.answers
    : {};

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getConfidenceColor = (level: string | null) => {
    switch (level) {
      case "HIGH": return "#22c55e";
      case "MEDIUM": return "#f59e0b";
      case "LOW": return "#ef4444";
      default: return "#6b7280";
    }
  };

  const getConfidenceLabel = (level: string | null) => {
    switch (level) {
      case "HIGH": return "Haute";
      case "MEDIUM": return "Moyenne";
      case "LOW": return "Faible";
      default: return "N/A";
    }
  };

  const fileTypeLabels: Record<string, string> = {
    facture: "Facture",
    fiche_technique: "Fiche technique",
    certificat: "Certificat",
    photo: "Photo",
    autre: "Autre",
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport de Classification - ${caseData.product_name}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      padding: 40px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #3b82f6;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 28px;
      color: #1e40af;
      margin-bottom: 8px;
    }
    .header .subtitle {
      color: #6b7280;
      font-size: 14px;
    }
    .section {
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1e40af;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .info-item {
      padding: 12px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .info-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-value {
      font-size: 15px;
      font-weight: 500;
      color: #1f2937;
      margin-top: 4px;
    }
    .hs-code-box {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 24px;
      border-radius: 12px;
      text-align: center;
      margin-bottom: 20px;
    }
    .hs-code-label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 8px;
    }
    .hs-code-value {
      font-size: 32px;
      font-weight: 700;
      font-family: 'Monaco', 'Consolas', monospace;
      letter-spacing: 2px;
    }
    .confidence-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 12px;
    }
    .justification {
      background: #f0f9ff;
      border-left: 4px solid #3b82f6;
      padding: 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 20px;
    }
    .justification-text {
      font-size: 14px;
      color: #1f2937;
    }
    .alternatives-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .alternative-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #f9fafb;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .alternative-code {
      font-family: 'Monaco', 'Consolas', monospace;
      font-weight: 600;
      color: #374151;
    }
    .alternative-conf {
      font-size: 13px;
      color: #6b7280;
    }
    .evidence-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .evidence-item {
      padding: 10px 14px;
      background: #fef3c7;
      border-radius: 6px;
      font-size: 13px;
      color: #92400e;
    }
    .answers-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .answer-item {
      padding: 12px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .answer-question {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .answer-value {
      font-size: 14px;
      font-weight: 500;
      color: #1f2937;
    }
    .files-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: #f9fafb;
      border-radius: 6px;
      font-size: 13px;
    }
    .file-name {
      color: #1f2937;
      font-weight: 500;
    }
    .file-type {
      color: #6b7280;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: #dcfce7;
      color: #166534;
    }
    @media print {
      body {
        padding: 20px;
      }
      .container {
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Rapport de Classification Douanière</h1>
      <div class="subtitle">
        Généré le ${formatDate(new Date().toISOString())} • Référence: ${caseData.id.slice(0, 8).toUpperCase()}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Informations du Dossier</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Produit</div>
          <div class="info-value">${caseData.product_name}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Type d'opération</div>
          <div class="info-value">${caseData.type_import_export === "import" ? "Importation" : "Exportation"}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Pays d'origine</div>
          <div class="info-value">${caseData.origin_country}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Entreprise</div>
          <div class="info-value">${companyName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Date de création</div>
          <div class="info-value">${formatDate(caseData.created_at)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Date de validation</div>
          <div class="info-value">${caseData.validated_at ? formatDate(caseData.validated_at) : "N/A"}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Résultat de Classification</div>
      <div class="hs-code-box">
        <div class="hs-code-label">Code SH Recommandé</div>
        <div class="hs-code-value">${formatHsCode(classificationData.recommended_code)}</div>
        <div class="confidence-badge" style="background: ${getConfidenceColor(classificationData.confidence_level)}20; color: ${getConfidenceColor(classificationData.confidence_level)}">
          Confiance ${getConfidenceLabel(classificationData.confidence_level)} (${Math.round((classificationData.confidence || 0) * 100)}%)
        </div>
      </div>
      
      ${classificationData.justification_short ? `
      <div class="justification">
        <div class="justification-text">${classificationData.justification_short}</div>
      </div>
      ` : ""}
    </div>

    ${alternatives.length > 0 ? `
    <div class="section">
      <div class="section-title">Codes Alternatifs</div>
      <div class="alternatives-list">
        ${alternatives.map(alt => `
          <div class="alternative-item">
            <span class="alternative-code">${formatHsCode(alt.code || "")}</span>
            <span class="alternative-conf">${Math.round((alt.confidence || 0) * 100)}% - ${alt.reason || ""}</span>
          </div>
        `).join("")}
      </div>
    </div>
    ` : ""}

    ${evidence.length > 0 ? `
    <div class="section">
      <div class="section-title">Éléments de Preuve</div>
      <div class="evidence-list">
        ${evidence.map(ev => {
          const text = typeof ev === "string" ? ev : (ev as { text?: string }).text || "";
          return `<div class="evidence-item">${text}</div>`;
        }).join("")}
      </div>
    </div>
    ` : ""}

    ${Object.keys(answers).length > 0 ? `
    <div class="section">
      <div class="section-title">Questions & Réponses</div>
      <div class="answers-list">
        ${Object.entries(answers).map(([q, a]) => `
          <div class="answer-item">
            <div class="answer-question">${q}</div>
            <div class="answer-value">${a}</div>
          </div>
        `).join("")}
      </div>
    </div>
    ` : ""}

    ${files.length > 0 ? `
    <div class="section">
      <div class="section-title">Documents Attachés</div>
      <div class="files-list">
        ${files.map(f => `
          <div class="file-item">
            <span class="file-name">${f.filename}</span>
            <span class="file-type">${fileTypeLabels[f.file_type] || f.file_type}</span>
          </div>
        `).join("")}
      </div>
    </div>
    ` : ""}

    <div class="footer">
      <p>Ce document a été généré automatiquement par le système de classification douanière.</p>
      <p>Référence: ${caseData.id} • Classification effectuée le ${formatDate(classificationData.created_at)}</p>
    </div>
  </div>
</body>
</html>`;
}
