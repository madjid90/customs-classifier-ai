import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders } from "./cors.ts";

// ============================================================================
// COMMON ZOD SCHEMAS
// ============================================================================

/**
 * UUID schema - validates UUID v4 format
 */
export const UUIDSchema = z.string().uuid("Doit être un UUID valide");

/**
 * Phone schema - validates Moroccan phone format
 * Accepts: +212XXXXXXXXX, 0XXXXXXXXX, 212XXXXXXXXX
 */
export const PhoneSchema = z
  .string()
  .min(9, "Numéro trop court")
  .max(15, "Numéro trop long")
  .regex(/^(\+?212|0)?[5-7]\d{8}$/, "Format de téléphone invalide");

/**
 * OTP schema - 6-digit code
 */
export const OTPSchema = z
  .string()
  .length(6, "Le code doit contenir 6 chiffres")
  .regex(/^\d{6}$/, "Le code doit contenir uniquement des chiffres");

/**
 * HS Code schema - 10-digit customs code
 */
export const HSCodeSchema = z
  .string()
  .regex(/^\d{10}$/, "Le code SH doit contenir exactement 10 chiffres");

/**
 * HS Code 6-digit schema
 */
export const HSCode6Schema = z
  .string()
  .regex(/^\d{6}$/, "Le code SH doit contenir exactement 6 chiffres");

/**
 * Country code schema (ISO 3166-1 alpha-2)
 */
export const CountryCodeSchema = z
  .string()
  .length(2, "Code pays invalide")
  .regex(/^[A-Z]{2}$/, "Le code pays doit être en majuscules (ex: MA, FR)");

/**
 * Import/Export type enum
 */
export const ImportExportTypeSchema = z.enum(["import", "export"], {
  errorMap: () => ({ message: "Type doit être 'import' ou 'export'" }),
});

/**
 * Confidence level enum
 */
export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

/**
 * User role enum
 */
export const UserRoleSchema = z.enum(["admin", "manager", "agent"]);

/**
 * Case status enum
 */
export const CaseStatusSchema = z.enum(["IN_PROGRESS", "RESULT_READY", "VALIDATED", "ERROR"]);

/**
 * Classification status enum
 */
export const ClassifyStatusSchema = z.enum(["NEED_INFO", "DONE", "ERROR", "LOW_CONFIDENCE"]);

/**
 * Pagination schema
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Date range schema
 */
export const DateRangeSchema = z.object({
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.start_date && data.end_date) {
      return new Date(data.start_date) <= new Date(data.end_date);
    }
    return true;
  },
  { message: "La date de début doit être antérieure à la date de fin" }
);

/**
 * Safe string schema - prevents XSS and injection
 * Trims whitespace, limits length, removes dangerous characters
 */
export const SafeStringSchema = (maxLength = 500) =>
  z
    .string()
    .trim()
    .max(maxLength, `Maximum ${maxLength} caractères`)
    .transform((val) => val.replace(/[<>]/g, "")); // Basic XSS prevention

/**
 * Product name schema
 */
export const ProductNameSchema = z
  .string()
  .trim()
  .min(2, "Nom du produit trop court")
  .max(200, "Nom du produit trop long");

/**
 * Description schema
 */
export const DescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description trop longue")
  .optional();

// ============================================================================
// COMPOSITE SCHEMAS
// ============================================================================

/**
 * Case creation schema
 */
export const CreateCaseSchema = z.object({
  product_name: ProductNameSchema,
  origin_country: CountryCodeSchema,
  type_import_export: ImportExportTypeSchema,
});

/**
 * Classify request schema
 */
export const ClassifyRequestSchema = z.object({
  case_id: UUIDSchema,
});

/**
 * Answer question schema
 */
export const AnswerQuestionSchema = z.object({
  case_id: UUIDSchema,
  question_id: z.string().min(1, "ID question requis"),
  answer: z.string().min(1, "Réponse requise").max(1000, "Réponse trop longue"),
});

/**
 * File attachment schema
 */
export const FileAttachmentSchema = z.object({
  case_id: UUIDSchema,
  filename: z.string().min(1).max(255),
  file_type: z.enum([
    "tech_sheet",
    "invoice",
    "packing_list",
    "certificate",
    "dum",
    "photo_product",
    "photo_label",
    "photo_plate",
    "other",
  ]),
  size_bytes: z.number().int().positive().max(50 * 1024 * 1024), // Max 50MB
});

/**
 * Presign request schema
 */
export const PresignRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().regex(/^[\w-]+\/[\w-]+$/, "Content-Type invalide"),
});

// ============================================================================
// VALIDATION RESULT TYPE
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: Response };

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates input against a Zod schema and returns a structured result
 * If validation fails, returns a formatted error Response
 */
export function validateInput<T extends z.ZodType>(
  schema: T,
  data: unknown,
  customCorsHeaders?: Record<string, string>
): ValidationResult<z.infer<T>> {
  const headers = customCorsHeaders || corsHeaders;
  const result = schema.safeParse(data);

  if (!result.success) {
    const formattedErrors = result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "root",
      message: issue.message,
      code: issue.code,
    }));

    return {
      success: false,
      error: new Response(
        JSON.stringify({
          error: "Erreur de validation",
          code: "VALIDATION_ERROR",
          details: formattedErrors,
        }),
        {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      ),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validates JSON body from request
 * Returns parsed data or error response
 */
export async function validateRequestBody<T extends z.ZodType>(
  req: Request,
  schema: T,
  customCorsHeaders?: Record<string, string>
): Promise<ValidationResult<z.infer<T>>> {
  const headers = customCorsHeaders || corsHeaders;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      success: false,
      error: new Response(
        JSON.stringify({
          error: "Corps de requête JSON invalide",
          code: "INVALID_JSON",
        }),
        {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      ),
    };
  }

  return validateInput(schema, body, headers);
}

/**
 * Validates URL query parameters
 */
export function validateQueryParams<T extends z.ZodType>(
  url: URL,
  schema: T,
  customCorsHeaders?: Record<string, string>
): ValidationResult<z.infer<T>> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return validateInput(schema, params, customCorsHeaders);
}

/**
 * Validates path parameter (e.g., /cases/:id)
 */
export function validatePathParam(
  param: string | undefined,
  paramName: string,
  schema: z.ZodType = UUIDSchema,
  customCorsHeaders?: Record<string, string>
): ValidationResult<string> {
  const headers = customCorsHeaders || corsHeaders;

  if (!param) {
    return {
      success: false,
      error: new Response(
        JSON.stringify({
          error: `Paramètre ${paramName} manquant`,
          code: "MISSING_PARAM",
        }),
        {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      ),
    };
  }

  return validateInput(schema, param, headers);
}

// ============================================================================
// SANITIZATION HELPERS
// ============================================================================

/**
 * Normalizes phone number to E.164 format (Morocco)
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = "212" + cleaned.slice(1);
  }
  if (!cleaned.startsWith("212") && cleaned.length === 9) {
    cleaned = "212" + cleaned;
  }

  return "+" + cleaned;
}

/**
 * Normalizes HS code - removes dots and spaces
 */
export function normalizeHSCode(code: string): string {
  return code.replace(/[\.\s-]/g, "");
}

/**
 * Sanitizes string for safe database storage
 * Removes null bytes and trims whitespace
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/\0/g, "") // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control chars
    .trim();
}

/**
 * Validates and extracts ID from URL path
 * Example: /cases/123e4567-e89b-12d3-a456-426614174000 → UUID
 */
export function extractIdFromPath(
  url: URL,
  basePath: string
): string | null {
  const path = url.pathname;
  const regex = new RegExp(`^${basePath}/([^/]+)/?$`);
  const match = path.match(regex);
  return match ? match[1] : null;
}
