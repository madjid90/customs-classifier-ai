// API functions that use the centralized API client
// All endpoints call the backend API as per the OpenAPI specification

import * as apiClient from "./api-client";

// Re-export all functions from api-client for backward compatibility
export const createCase = apiClient.createCase;
export const getCases = apiClient.getCases;
export const getCaseDetail = apiClient.getCaseDetail;
export const validateCase = apiClient.validateCase;
export const presignFile = apiClient.presignFile;
export const attachFile = apiClient.attachFile;
export const uploadAndAttachFile = apiClient.uploadAndAttachFile;
export const classify = apiClient.classify;
export const exportPdf = apiClient.exportPdf;
export const getIngestionList = apiClient.getIngestionList;
export const registerIngestion = apiClient.registerIngestion;
export const runEtl = apiClient.runEtl;
export const getIngestionLogs = apiClient.getIngestionLogs;
export const retryIngestion = apiClient.retryIngestion;
export const disableIngestion = apiClient.disableIngestion;
export const searchKB = apiClient.searchKB;

// Legacy function names for compatibility
export async function uploadFile(caseId: string, file: File, fileType: string) {
  return apiClient.uploadAndAttachFile(caseId, file, fileType);
}

export async function uploadIngestionFile(file: File): Promise<string> {
  // Upload via presign for admin ingestion files
  const presignRes = await apiClient.presignFile({
    case_id: null,
    file_type: "admin_ingestion",
    filename: file.name,
    content_type: file.type,
  });

  const { upload_url, file_url } = presignRes.data;

  await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  return file_url;
}
