import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import axios from "axios";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export type CheckResult = {
  id: string;
  method: "GET" | "POST";
  path: string;
  status: number;
  ok: boolean;
  error?: string;
  responseSnippet?: string;
  isBlocker?: boolean;
  skipped?: boolean;
  skipReason?: string;
};

function snippet(obj: unknown, max = 400): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + "..." : s;
  } catch {
    return "";
  }
}

// Resolve a local $ref "#/components/schemas/XYZ"
function resolveRef(openapi: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: unknown = openapi;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur || null;
}

// Convert OpenAPI schema -> JSON Schema usable by AJV
function toJsonSchema(openapi: Record<string, unknown>, schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;

  const schemaObj = schema as Record<string, unknown>;

  // $ref
  if (schemaObj.$ref && typeof schemaObj.$ref === "string") {
    const resolved = resolveRef(openapi, schemaObj.$ref);
    return toJsonSchema(openapi, resolved);
  }

  // allOf
  if (Array.isArray(schemaObj.allOf)) {
    return { allOf: schemaObj.allOf.map((s) => toJsonSchema(openapi, s)) };
  }

  // oneOf / anyOf
  if (Array.isArray(schemaObj.oneOf)) {
    return { oneOf: schemaObj.oneOf.map((s) => toJsonSchema(openapi, s)) };
  }
  if (Array.isArray(schemaObj.anyOf)) {
    return { anyOf: schemaObj.anyOf.map((s) => toJsonSchema(openapi, s)) };
  }

  // type object
  if (schemaObj.type === "object" || schemaObj.properties || schemaObj.additionalProperties !== undefined) {
    const props: Record<string, unknown> = {};
    const properties = schemaObj.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const [k, v] of Object.entries(properties)) {
        props[k] = toJsonSchema(openapi, v);
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
          : toJsonSchema(openapi, schemaObj.additionalProperties);
    }
    return out;
  }

  // type array
  if (schemaObj.type === "array") {
    return {
      type: "array",
      items: toJsonSchema(openapi, schemaObj.items),
      maxItems: schemaObj.maxItems,
      minItems: schemaObj.minItems,
    };
  }

  // primitives
  const primitive: Record<string, unknown> = { ...schemaObj };
  // AJV doesn't like nullable in OpenAPI 3.0, convert to type union
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

function getHeaders() {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
}

export async function runOpenApiContractChecks(): Promise<CheckResult[]> {
  // 1) Load OpenAPI YAML
  const openapi = await SwaggerParser.bundle("/openapi.yaml") as Record<string, unknown>;

  // 2) AJV setup
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  // Helper: get response schema from OpenAPI
  function getResponseSchema(method: string, path: string, status: number): unknown {
    const paths = openapi.paths as Record<string, Record<string, unknown>> | undefined;
    const pathItem = paths?.[path];
    const operation = pathItem?.[method.toLowerCase()] as Record<string, unknown> | undefined;
    const responses = operation?.responses as Record<string, Record<string, unknown>> | undefined;
    const response = responses?.[String(status)];
    const content = response?.content as Record<string, Record<string, unknown>> | undefined;
    const jsonContent = content?.["application/json"];
    return jsonContent?.schema || null;
  }

  const results: CheckResult[] = [];
  let createdCaseId: string | null = null;

  // Check if user is authenticated
  const token = localStorage.getItem("auth_token");
  const isAuthenticated = !!token;

  // 3) AUTH_SEND_OTP - Skip in tests (would send real SMS)
  results.push({
    id: "AUTH_SEND_OTP",
    method: "POST",
    path: "/send-otp",
    status: 0,
    ok: true,
    skipped: true,
    skipReason: "Skipped - would send real SMS",
  });

  // 4) AUTH_VERIFY_OTP - Skip in tests
  results.push({
    id: "AUTH_VERIFY_OTP",
    method: "POST",
    path: "/verify-otp",
    status: 0,
    ok: true,
    skipped: true,
    skipReason: "Skipped - requires valid OTP",
  });

  // 5) CASES_LIST
  if (isAuthenticated) {
    const path = "/cases";
    const schema = getResponseSchema("GET", path, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.get(`${FUNCTIONS_URL}${path}`, { headers: getHeaders() });
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "CASES_LIST",
        method: "GET",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
      });

      // Get first case ID for detail check
      if (res.data?.cases?.length > 0) {
        createdCaseId = res.data.cases[0].id;
      }
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({
        id: "CASES_LIST",
        method: "GET",
        path,
        status: axiosError.response?.status || 0,
        ok: false,
        error: axiosError.message || "Request failed",
        responseSnippet: snippet(axiosError.response?.data),
      });
    }
  } else {
    results.push({
      id: "CASES_LIST",
      method: "GET",
      path: "/cases",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: "Skipped - requires authentication",
    });
  }

  // 6) CASES_CREATE - Only test if authenticated
  if (isAuthenticated) {
    const path = "/cases";
    const schema = getResponseSchema("POST", path, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.post(
        `${FUNCTIONS_URL}${path}`,
        {
          type_import_export: "import",
          origin_country: "MA",
          product_name: "Test OpenAPI Contract Check - " + Date.now(),
        },
        { headers: getHeaders() }
      );
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "CASES_CREATE",
        method: "POST",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
      });

      if (res.data?.id) {
        createdCaseId = res.data.id;
      }
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({
        id: "CASES_CREATE",
        method: "POST",
        path,
        status: axiosError.response?.status || 0,
        ok: false,
        error: axiosError.message || "Request failed",
        responseSnippet: snippet(axiosError.response?.data),
      });
    }
  } else {
    results.push({
      id: "CASES_CREATE",
      method: "POST",
      path: "/cases",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: "Skipped - requires authentication",
    });
  }

  // 7) CASES_DETAIL - Test if we have a case ID
  if (createdCaseId && isAuthenticated) {
    const path = `/cases/${createdCaseId}`;
    const templatePath = "/cases/{case_id}";
    const schema = getResponseSchema("GET", templatePath, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.get(`${FUNCTIONS_URL}${path}`, { headers: getHeaders() });
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "CASES_DETAIL",
        method: "GET",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
      });
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({
        id: "CASES_DETAIL",
        method: "GET",
        path,
        status: axiosError.response?.status || 0,
        ok: false,
        error: axiosError.message || "Request failed",
        responseSnippet: snippet(axiosError.response?.data),
      });
    }
  } else {
    results.push({
      id: "CASES_DETAIL",
      method: "GET",
      path: "/cases/{case_id}",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: createdCaseId ? "Skipped - requires authentication" : "Skipped - no case_id available",
    });
  }

  // 8) FILES_PRESIGN
  if (isAuthenticated) {
    const path = "/files-presign";
    const schema = getResponseSchema("POST", path, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.post(
        `${FUNCTIONS_URL}${path}`,
        {
          case_id: createdCaseId,
          file_type: "other",
          filename: "test-openapi-check.pdf",
          content_type: "application/pdf",
        },
        { headers: getHeaders() }
      );
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "FILES_PRESIGN",
        method: "POST",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
      });
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({
        id: "FILES_PRESIGN",
        method: "POST",
        path,
        status: axiosError.response?.status || 0,
        ok: false,
        error: axiosError.message || "Request failed",
        responseSnippet: snippet(axiosError.response?.data),
      });
    }
  } else {
    results.push({
      id: "FILES_PRESIGN",
      method: "POST",
      path: "/files-presign",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: "Skipped - requires authentication",
    });
  }

  // 9) CLASSIFY - CRITIQUE - Requires case_id with files
  if (createdCaseId && isAuthenticated) {
    const path = "/classify";
    const schema = getResponseSchema("POST", path, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.post(
        `${FUNCTIONS_URL}${path}`,
        {
          case_id: createdCaseId,
          file_urls: [],
          answers: {},
          context: {
            type_import_export: "import",
            origin_country: "MA",
          },
        },
        { headers: getHeaders(), timeout: 120000 }
      );
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "CLASSIFY",
        method: "POST",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
        isBlocker: !ok,
      });
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({
        id: "CLASSIFY",
        method: "POST",
        path,
        status: axiosError.response?.status || 0,
        ok: false,
        error: axiosError.message || "Request failed",
        responseSnippet: snippet(axiosError.response?.data),
        isBlocker: true,
      });
    }
  } else {
    results.push({
      id: "CLASSIFY",
      method: "POST",
      path: "/classify",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: createdCaseId ? "Skipped - requires authentication" : "Skipped - no case_id available",
      isBlocker: false,
    });
  }

  // 10) EXPORT_PDF
  if (createdCaseId && isAuthenticated) {
    const path = "/export-pdf";
    const schema = getResponseSchema("POST", path, 200);
    const jsonSchema = toJsonSchema(openapi, schema);
    const validate = jsonSchema ? ajv.compile(jsonSchema as object) : null;

    try {
      const res = await axios.post(
        `${FUNCTIONS_URL}${path}`,
        { case_id: createdCaseId },
        { headers: getHeaders() }
      );
      const ok = validate ? !!validate(res.data) : true;
      results.push({
        id: "EXPORT_PDF",
        method: "POST",
        path,
        status: res.status,
        ok,
        error: ok ? undefined : ajv.errorsText(validate?.errors),
        responseSnippet: snippet(res.data),
      });
    } catch (e: unknown) {
      const axiosError = e as { response?: { status?: number; data?: unknown }; message?: string };
      // 404 is expected if case has no result yet
      const is404 = axiosError.response?.status === 404;
      results.push({
        id: "EXPORT_PDF",
        method: "POST",
        path,
        status: axiosError.response?.status || 0,
        ok: is404, // 404 is acceptable (no result to export)
        error: is404 ? "Expected - no classification result yet" : (axiosError.message || "Request failed"),
        responseSnippet: snippet(axiosError.response?.data),
      });
    }
  } else {
    results.push({
      id: "EXPORT_PDF",
      method: "POST",
      path: "/export-pdf",
      status: 0,
      ok: true,
      skipped: true,
      skipReason: createdCaseId ? "Skipped - requires authentication" : "Skipped - no case_id available",
    });
  }

  return results;
}

// Validate a single response against OpenAPI schema
export async function validateResponse(
  method: string,
  path: string,
  status: number,
  responseData: unknown
): Promise<{ valid: boolean; errors?: string }> {
  const openapi = await SwaggerParser.bundle("/openapi.yaml") as Record<string, unknown>;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const paths = openapi.paths as Record<string, Record<string, unknown>> | undefined;
  
  // Try exact path first, then template
  let pathItem = paths?.[path];
  if (!pathItem) {
    // Try to find template path
    const templatePath = Object.keys(paths || {}).find((p) => {
      const regex = new RegExp("^" + p.replace(/\{[^}]+\}/g, "[^/]+") + "$");
      return regex.test(path);
    });
    if (templatePath) {
      pathItem = paths?.[templatePath];
    }
  }

  const operation = pathItem?.[method.toLowerCase()] as Record<string, unknown> | undefined;
  const responses = operation?.responses as Record<string, Record<string, unknown>> | undefined;
  const response = responses?.[String(status)];
  const content = response?.content as Record<string, Record<string, unknown>> | undefined;
  const jsonContent = content?.["application/json"];
  const schema = jsonContent?.schema;

  if (!schema) {
    return { valid: true }; // No schema to validate against
  }

  const jsonSchema = toJsonSchema(openapi, schema);
  if (!jsonSchema) {
    return { valid: true };
  }

  const validate = ajv.compile(jsonSchema as object);
  const valid = validate(responseData);

  return {
    valid: !!valid,
    errors: valid ? undefined : ajv.errorsText(validate.errors),
  };
}
