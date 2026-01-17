import { supabase } from "@/integrations/supabase/client";

// Cases
export async function createCase(data: { 
  type_import_export: "import" | "export"; 
  origin_country: string; 
  product_name: string; 
}) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  // Get user's company
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("company_id, phone")
    .eq("user_id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found");
  }

  // Create case
  const { data: caseData, error } = await supabase
    .from("cases")
    .insert({
      company_id: profile.company_id,
      type_import_export: data.type_import_export,
      origin_country: data.origin_country,
      product_name: data.product_name,
      created_by: userData.user.id,
    })
    .select("id, status, created_at")
    .single();

  if (error) throw error;

  // Create audit log
  await supabase.from("audit_logs").insert({
    case_id: caseData.id,
    action: "created",
    user_id: userData.user.id,
    user_phone: profile.phone,
    meta: { product_name: data.product_name },
  });

  return { data: caseData };
}

export async function getCases(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  q?: string;
  created_by?: string;
  date_from?: string;
  date_to?: string;
}) {
  const limit = params?.limit || 20;
  const offset = params?.offset || 0;

  let query = supabase
    .from("cases")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params?.status) {
    query = query.eq("status", params.status as "IN_PROGRESS" | "RESULT_READY" | "VALIDATED" | "ERROR");
  }
  if (params?.q) {
    query = query.ilike("product_name", `%${params.q}%`);
  }
  if (params?.created_by) {
    query = query.eq("created_by", params.created_by);
  }
  if (params?.date_from) {
    query = query.gte("created_at", params.date_from);
  }
  if (params?.date_to) {
    query = query.lte("created_at", params.date_to);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    data: {
      items: data || [],
      total: count || 0,
      limit,
      offset,
      has_more: (count || 0) > offset + limit,
    },
  };
}

export async function getCaseDetail(caseId: string) {
  // Get case
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .single();

  if (caseError) throw caseError;

  // Get files
  const { data: files, error: filesError } = await supabase
    .from("case_files")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (filesError) throw filesError;

  // Get latest result
  const { data: results, error: resultsError } = await supabase
    .from("classification_results")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (resultsError) throw resultsError;

  // Get audit logs
  const { data: audit, error: auditError } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (auditError) throw auditError;

  return {
    data: {
      case: caseData,
      files: files || [],
      last_result: results && results.length > 0 ? results[0] : null,
      audit: audit || [],
    },
  };
}

export async function validateCase(caseId: string) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("user_id", userData.user.id)
    .single();

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("cases")
    .update({
      status: "VALIDATED",
      validated_by: userData.user.id,
      validated_at: now,
    })
    .eq("id", caseId);

  if (error) throw error;

  // Create audit log
  await supabase.from("audit_logs").insert({
    case_id: caseId,
    action: "validated",
    user_id: userData.user.id,
    user_phone: profile?.phone || "",
    meta: {},
  });

  return { data: { ok: true, validated_at: now } };
}

// Files
export async function uploadFile(caseId: string, file: File, fileType: string) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("user_id", userData.user.id)
    .single();

  // Generate unique filename
  const ext = file.name.split(".").pop();
  const filename = `${caseId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  // Upload to storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("case-files")
    .upload(filename, file);

  if (uploadError) throw uploadError;

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("case-files")
    .getPublicUrl(filename);

  // Create file record
  const { data: fileData, error: fileError } = await supabase
    .from("case_files")
    .insert([{
      case_id: caseId,
      file_type: fileType as "tech_sheet" | "invoice" | "packing_list" | "certificate" | "dum" | "photo_product" | "photo_label" | "photo_plate" | "other" | "admin_ingestion",
      file_url: urlData.publicUrl,
      filename: file.name,
      size_bytes: file.size,
    }])
    .select("*")
    .single();

  if (fileError) throw fileError;

  // Create audit log
  await supabase.from("audit_logs").insert({
    case_id: caseId,
    action: "file_uploaded",
    user_id: userData.user.id,
    user_phone: profile?.phone || "",
    meta: { filename: file.name, file_type: fileType },
  });

  return fileData;
}

// Classification - this will call edge function for actual AI classification
export async function classify(payload: {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}) {
  const { data, error } = await supabase.functions.invoke("classify", {
    body: payload,
  });

  if (error) throw error;

  return { data };
}

// Export PDF
export async function exportPdf(caseId: string) {
  const { data, error } = await supabase.functions.invoke("export-pdf", {
    body: { case_id: caseId },
  });

  if (error) throw error;

  return { data };
}

// Admin - Ingestion
export async function getIngestionList() {
  const { data, error, count } = await supabase
    .from("ingestion_files")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (error) throw error;

  return { data: { items: data || [], total: count || 0 } };
}

export async function registerIngestion(input: {
  source: string;
  version_label: string;
  file_url: string;
}) {
  const filename = input.file_url.split("/").pop() || "file";

  const { data, error } = await supabase
    .from("ingestion_files")
    .insert([{
      source: input.source as "omd" | "maroc" | "lois" | "dum",
      version_label: input.version_label,
      file_url: input.file_url,
      filename,
    }])
    .select("id, status")
    .single();

  if (error) throw error;

  return { data: { ingestion_id: data.id, status: data.status } };
}

export async function runEtl(ingestionId: string) {
  const { data, error } = await supabase.functions.invoke("run-etl", {
    body: { ingestion_id: ingestionId },
  });

  if (error) throw error;

  return { data };
}

export async function getIngestionLogs(ingestionId: string) {
  const { data, error, count } = await supabase
    .from("ingestion_logs")
    .select("*", { count: "exact" })
    .eq("ingestion_id", ingestionId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return { data: { items: data || [], total: count || 0 } };
}

export async function retryIngestion(ingestionId: string) {
  const { error } = await supabase
    .from("ingestion_files")
    .update({ status: "NEW", progress_percent: 0, error_message: null })
    .eq("id", ingestionId);

  if (error) throw error;

  return { data: { ok: true } };
}

export async function disableIngestion(ingestionId: string) {
  const { error } = await supabase
    .from("ingestion_files")
    .update({ status: "DISABLED" })
    .eq("id", ingestionId);

  if (error) throw error;

  return { data: { ok: true } };
}

export async function searchKB(q: string) {
  const { data, error, count } = await supabase
    .from("kb_chunks")
    .select("*", { count: "exact" })
    .textSearch("text", q)
    .limit(20);

  if (error) throw error;

  // Add a mock score since we're not doing vector search yet
  const chunks = (data || []).map((chunk, i) => ({
    ...chunk,
    score: 1 - i * 0.05,
  }));

  return { data: { chunks, total: count || 0 } };
}

// Admin file upload for ingestion
export async function uploadIngestionFile(file: File) {
  const filename = `ingestion/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("case-files")
    .upload(filename, file);

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from("case-files")
    .getPublicUrl(filename);

  return urlData.publicUrl;
}
