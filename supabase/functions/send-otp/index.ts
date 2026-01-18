import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { PhoneSchema, validateRequestBody, normalizePhone } from "../_shared/validation.ts";

// Generate a 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Request schema for send-otp
const SendOtpSchema = z.object({
  phone: PhoneSchema,
});

// Send SMS via Twilio
async function sendSmsViaTwilio(to: string, message: string): Promise<{ success: boolean; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromPhone) {
    logger.error("[send-otp] Twilio credentials not configured");
    return { success: false, error: "SMS service not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  
  const credentials = btoa(`${accountSid}:${authToken}`);
  
  const body = new URLSearchParams({
    To: to,
    From: fromPhone,
    Body: message,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error("[send-otp] Twilio error:", data);
      return { success: false, error: data.message || "Failed to send SMS" };
    }

    logger.info(`[send-otp] SMS sent successfully, SID: ${data.sid}`);
    return { success: true };
  } catch (error) {
    logger.error("[send-otp] Twilio request failed:", error);
    return { success: false, error: "SMS service unavailable" };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate request body using centralized schema
    const validation = await validateRequestBody(req, SendOtpSchema);
    if (!validation.success) {
      return validation.error;
    }

    const { phone } = validation.data;
    const normalizedPhoneNumber = normalizePhone(phone);
    logger.info(`[send-otp] Processing OTP request for phone: ${normalizedPhoneNumber}`);

    // Validate E.164 format after normalization
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    if (!phoneRegex.test(normalizedPhoneNumber)) {
      return new Response(
        JSON.stringify({ error: "Format de téléphone invalide", code: "INVALID_PHONE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check rate limiting - max 5 OTPs per phone per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("phone", normalizedPhoneNumber)
      .gte("created_at", oneHourAgo);

    if (recentCount && recentCount >= 5) {
      logger.warn(`[send-otp] Rate limit exceeded for phone: ${normalizedPhoneNumber}`);
      return new Response(
        JSON.stringify({ error: "Trop de demandes. Veuillez patienter avant de demander un nouveau code.", code: "RATE_LIMITED" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalidate previous OTPs for this phone
    await supabase
      .from("otp_codes")
      .delete()
      .eq("phone", normalizedPhoneNumber)
      .eq("verified", false);

    // Store new OTP
    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({
        phone: normalizedPhoneNumber,
        code: otp,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      logger.error(`[send-otp] Error storing OTP:`, insertError);
      return new Response(
        JSON.stringify({ error: "Échec de génération du code OTP", code: "INTERNAL_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send SMS via Twilio
    const smsMessage = `Votre code de vérification est: ${otp}. Ce code expire dans 5 minutes.`;
    const smsResult = await sendSmsViaTwilio(normalizedPhoneNumber, smsMessage);

    if (!smsResult.success) {
      logger.error(`[send-otp] Failed to send SMS:`, smsResult.error);
      // Delete the OTP since SMS failed
      await supabase
        .from("otp_codes")
        .delete()
        .eq("phone", normalizedPhoneNumber)
        .eq("code", otp);
      
      return new Response(
        JSON.stringify({ error: smsResult.error || "Échec d'envoi du SMS", code: "SMS_FAILED" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`[send-otp] OTP sent to ${normalizedPhoneNumber} (expires: ${expiresAt.toISOString()})`);

    // Return success
    return new Response(
      JSON.stringify({
        ok: true,
        expires_in: 300, // 5 minutes in seconds
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error(`[send-otp] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
