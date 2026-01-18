/**
 * OpenAPI Response Validator Middleware
 * 
 * Validates API responses against the OpenAPI schema in real-time.
 * Only active in development mode by default.
 */

import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

// Configuration
export interface ValidatorConfig {
  enabled: boolean;
  strict: boolean; // If true, throws on validation errors; if false, just warns
  logLevel: "none" | "warn" | "error" | "verbose";
  excludePaths: string[]; // Paths to exclude from validation
  criticalPaths: string[]; // Paths that must pass validation (throws even in non-strict mode)
}

const DEFAULT_CONFIG: ValidatorConfig = {
  enabled: import.meta.env.DEV,
  strict: false,
  logLevel: "warn",
  excludePaths: ["/admin/"],
  criticalPaths: ["/classify"],
};

let config: ValidatorConfig = { ...DEFAULT_CONFIG };
let openApiSpec: Record<string, unknown> | null = null;
let ajv: Ajv | null = null;
let schemaCache: Map<string, ValidateFunction> = new Map();

// Configure the validator
export function configureValidator(newConfig: Partial<ValidatorConfig>): void {
  config = { ...config, ...newConfig };
}

// Get current config
export function getValidatorConfig(): ValidatorConfig {
  return { ...config };
}

// Load OpenAPI spec (lazy loaded)
async function loadOpenApiSpec(): Promise<Record<string, unknown>> {
  if (openApiSpec) return openApiSpec;

  try {
    // Dynamic import to avoid bundling in production if not needed
    const SwaggerParser = (await import("@apidevtools/swagger-parser")).default;
    openApiSpec = await SwaggerParser.bundle("/openapi.yaml") as Record<string, unknown>;
    
    // Initialize AJV
    ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    
    return openApiSpec;
  } catch (error) {
    console.error("[OpenAPI Validator] Failed to load spec:", error);
    throw error;
  }
}

// Resolve a $ref in the OpenAPI spec
function resolveRef(spec: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: unknown = spec;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur || null;
}

// Convert OpenAPI schema to JSON Schema
function toJsonSchema(spec: Record<string, unknown>, schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;

  const schemaObj = schema as Record<string, unknown>;

  if (schemaObj.$ref && typeof schemaObj.$ref === "string") {
    return toJsonSchema(spec, resolveRef(spec, schemaObj.$ref));
  }

  if (Array.isArray(schemaObj.allOf)) {
    return { allOf: schemaObj.allOf.map((s) => toJsonSchema(spec, s)) };
  }

  if (Array.isArray(schemaObj.oneOf)) {
    return { oneOf: schemaObj.oneOf.map((s) => toJsonSchema(spec, s)) };
  }

  if (Array.isArray(schemaObj.anyOf)) {
    return { anyOf: schemaObj.anyOf.map((s) => toJsonSchema(spec, s)) };
  }

  if (schemaObj.type === "object" || schemaObj.properties || schemaObj.additionalProperties !== undefined) {
    const props: Record<string, unknown> = {};
    const properties = schemaObj.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const [k, v] of Object.entries(properties)) {
        props[k] = toJsonSchema(spec, v);
      }
    }
    const out: Record<string, unknown> = {
      type: "object",
      properties: props,
    };
    if (schemaObj.required) out.required = schemaObj.required;
    if (schemaObj.additionalProperties !== undefined) {
      out.additionalProperties = schemaObj.additionalProperties === true
        ? true
        : schemaObj.additionalProperties === false
          ? false
          : toJsonSchema(spec, schemaObj.additionalProperties);
    }
    return out;
  }

  if (schemaObj.type === "array") {
    return {
      type: "array",
      items: toJsonSchema(spec, schemaObj.items),
      maxItems: schemaObj.maxItems,
      minItems: schemaObj.minItems,
    };
  }

  const primitive: Record<string, unknown> = { ...schemaObj };
  if (primitive.nullable) {
    delete primitive.nullable;
    if (primitive.type) {
      primitive.type = Array.isArray(primitive.type)
        ? [...primitive.type, "null"]
        : [primitive.type, "null"];
    } else {
      primitive.type = ["null"];
    }
  }
  return primitive;
}

// Find matching path template in OpenAPI spec
function findPathTemplate(paths: Record<string, unknown>, requestPath: string): string | null {
  // First try exact match
  if (paths[requestPath]) return requestPath;

  // Try to find template match
  for (const template of Object.keys(paths)) {
    const regex = new RegExp(
      "^" + template.replace(/\{[^}]+\}/g, "[^/]+") + "$"
    );
    if (regex.test(requestPath)) {
      return template;
    }
  }

  return null;
}

// Get response schema for a specific endpoint
function getResponseSchema(
  spec: Record<string, unknown>,
  method: string,
  path: string,
  status: number
): unknown {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return null;

  const templatePath = findPathTemplate(paths, path);
  if (!templatePath) return null;

  const pathItem = paths[templatePath];
  const operation = pathItem?.[method.toLowerCase()] as Record<string, unknown> | undefined;
  const responses = operation?.responses as Record<string, Record<string, unknown>> | undefined;
  const response = responses?.[String(status)];
  const content = response?.content as Record<string, Record<string, unknown>> | undefined;
  const jsonContent = content?.["application/json"];
  return jsonContent?.schema || null;
}

// Get or create validator for a specific endpoint
function getValidator(
  spec: Record<string, unknown>,
  method: string,
  path: string,
  status: number
): ValidateFunction | null {
  if (!ajv) return null;

  const cacheKey = `${method}:${path}:${status}`;
  
  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey) || null;
  }

  const schema = getResponseSchema(spec, method, path, status);
  if (!schema) {
    schemaCache.set(cacheKey, null as unknown as ValidateFunction);
    return null;
  }

  const jsonSchema = toJsonSchema(spec, schema);
  if (!jsonSchema) {
    schemaCache.set(cacheKey, null as unknown as ValidateFunction);
    return null;
  }

  try {
    const validate = ajv.compile(jsonSchema as object);
    schemaCache.set(cacheKey, validate);
    return validate;
  } catch (error) {
    console.error(`[OpenAPI Validator] Failed to compile schema for ${cacheKey}:`, error);
    schemaCache.set(cacheKey, null as unknown as ValidateFunction);
    return null;
  }
}

// Check if path should be excluded
function shouldExclude(path: string): boolean {
  return config.excludePaths.some((p) => path.includes(p));
}

// Check if path is critical
function isCriticalPath(path: string): boolean {
  return config.criticalPaths.some((p) => path.includes(p));
}

// Normalize path for matching
function normalizePath(url: string, baseUrl: string): string {
  // Remove base URL
  let path = url.replace(baseUrl, "");
  
  // Remove query params
  path = path.split("?")[0];
  
  // Ensure leading slash
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  
  // Handle functions/v1 prefix
  if (path.startsWith("/functions/v1")) {
    path = path.replace("/functions/v1", "");
  }
  
  return path;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string;
  path: string;
  method: string;
  status: number;
  isCritical: boolean;
}

/**
 * Validate an API response against the OpenAPI schema
 */
export async function validateApiResponse(
  method: string,
  url: string,
  status: number,
  data: unknown,
  baseUrl: string = ""
): Promise<ValidationResult> {
  const path = normalizePath(url, baseUrl);
  const isCritical = isCriticalPath(path);

  const result: ValidationResult = {
    valid: true,
    path,
    method: method.toUpperCase(),
    status,
    isCritical,
  };

  // Skip if disabled
  if (!config.enabled) {
    return result;
  }

  // Skip excluded paths
  if (shouldExclude(path)) {
    return result;
  }

  try {
    const spec = await loadOpenApiSpec();
    const validate = getValidator(spec, method, path, status);

    if (!validate) {
      // No schema found - not an error, just no validation
      if (config.logLevel === "verbose") {
        console.log(`[OpenAPI Validator] No schema for ${method} ${path} (${status})`);
      }
      return result;
    }

    const isValid = validate(data);

    if (!isValid) {
      const errors = ajv?.errorsText(validate.errors) || "Unknown validation error";
      result.valid = false;
      result.errors = errors;

      // Log based on config
      if (config.logLevel !== "none") {
        const logMethod = isCritical || config.logLevel === "error" ? "error" : "warn";
        console[logMethod](
          `[OpenAPI Validator] ${isCritical ? "🚨 CRITICAL " : ""}Validation failed for ${method} ${path}:`,
          errors,
          "\nResponse data:",
          data
        );
      }

      // Throw if strict mode or critical path
      if (config.strict || isCritical) {
        throw new OpenApiValidationError(
          `API response validation failed for ${method} ${path}: ${errors}`,
          result
        );
      }
    } else if (config.logLevel === "verbose") {
      console.log(`[OpenAPI Validator] ✓ ${method} ${path} (${status})`);
    }
  } catch (error) {
    if (error instanceof OpenApiValidationError) {
      throw error;
    }
    // Log loading/parsing errors but don't block the response
    console.error("[OpenAPI Validator] Error during validation:", error);
  }

  return result;
}

/**
 * Custom error class for validation failures
 */
export class OpenApiValidationError extends Error {
  public readonly validationResult: ValidationResult;

  constructor(message: string, result: ValidationResult) {
    super(message);
    this.name = "OpenApiValidationError";
    this.validationResult = result;
  }
}

/**
 * Create an Axios response interceptor for automatic validation
 */
export function createValidationInterceptor(baseUrl: string = "") {
  return async (response: { config: { method?: string; url?: string }; status: number; data: unknown }) => {
    const method = response.config.method || "GET";
    const url = response.config.url || "";
    
    await validateApiResponse(method, url, response.status, response.data, baseUrl);
    
    return response;
  };
}

// Reset validator state (useful for testing)
export function resetValidator(): void {
  openApiSpec = null;
  ajv = null;
  schemaCache = new Map();
  config = { ...DEFAULT_CONFIG };
}
