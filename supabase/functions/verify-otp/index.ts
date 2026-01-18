import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";
import { logger } from "../_shared/logger.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Normalize phone to E.164 format
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  
  if (cleaned.startsWith("0")) {
    cleaned = "212" + cleaned.slice(1);
  }
  if (!cleaned.startsWith("212") && cleaned.length === 9) {
    cleaned = "212" + cleaned;
  }
  
  return "+" + cleaned;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, otp } = await req.json();

    if (!phone || !otp) {
      return new Response(
        JSON.stringify({ message: "Phone and OTP are required", code: "MISSING_PARAMS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    logger.info(`[verify-otp] Verifying OTP for phone: ${normalizedPhone}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the latest OTP for this phone
    const { data: otpRecord, error: fetchError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("phone", normalizedPhone)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !otpRecord) {
      logger.warn(`[verify-otp] No OTP found for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ message: "Invalid or expired OTP", code: "INVALID_OTP" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if OTP is expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      logger.warn(`[verify-otp] OTP expired for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ message: "OTP has expired. Please request a new code.", code: "OTP_EXPIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check attempts (max 5)
    if (otpRecord.attempts >= 5) {
      logger.warn(`[verify-otp] Too many attempts for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ message: "Too many failed attempts. Account temporarily locked.", code: "LOCKED" }),
        { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify OTP
    if (otpRecord.code !== otp) {
      // Increment attempts
      await supabase
        .from("otp_codes")
        .update({ attempts: otpRecord.attempts + 1 })
        .eq("id", otpRecord.id);

      logger.warn(`[verify-otp] Invalid OTP attempt for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ message: "Invalid OTP code", code: "INVALID_OTP" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OTP is valid - mark as verified
    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    logger.info(`[verify-otp] OTP verified successfully for phone: ${normalizedPhone}`);

    // Find or create user profile
    let { data: profile } = await supabase
      .from("profiles")
      .select("id, user_id, company_id, phone")
      .eq("phone", normalizedPhone)
      .single();

    let userId: string;
    let companyId: string;

    if (!profile) {
      logger.info(`[verify-otp] Creating new user for phone: ${normalizedPhone}`);
      
      // Create a new company
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ name: `Company ${normalizedPhone}` })
        .select("id")
        .single();

      if (companyError || !newCompany) {
        logger.error(`[verify-otp] Error creating company:`, companyError);
        return new Response(
          JSON.stringify({ message: "Failed to create account", code: "INTERNAL_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      companyId = newCompany.id;

      // Create a user ID (since we're not using Supabase Auth email/password)
      userId = crypto.randomUUID();

      // Create profile
      const { data: newProfile, error: profileError } = await supabase
        .from("profiles")
        .insert({
          user_id: userId,
          company_id: companyId,
          phone: normalizedPhone,
        })
        .select("id, user_id, company_id, phone")
        .single();

      if (profileError || !newProfile) {
        logger.error(`[verify-otp] Error creating profile:`, profileError);
        return new Response(
          JSON.stringify({ message: "Failed to create profile", code: "INTERNAL_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      profile = newProfile;

      // Assign default role (agent)
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert({
          user_id: userId,
          role: "agent",
        });
      
      if (roleError) {
        logger.error(`[verify-otp] Error inserting role:`, roleError);
      } else {
        logger.debug(`[verify-otp] Assigned agent role to user: ${userId}`);
      }

      logger.info(`[verify-otp] Created new user with ID: ${userId}`);
    } else {
      userId = profile.user_id;
      companyId = profile.company_id;
    }

    // Get user role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();

    const userRole = roleData?.role || "agent";

    // Generate JWT token
    const jwtSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secretKey = new TextEncoder().encode(jwtSecret);
    
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000); // Unix timestamp
    
    const token = await new SignJWT({
      sub: userId,
      phone: normalizedPhone,
      company_id: companyId,
      role: userRole,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresAtTimestamp)
      .sign(secretKey);

    logger.info(`[verify-otp] Generated token for user: ${userId}`);

    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt.toISOString(),
        user: {
          id: userId,
          company_id: companyId,
          role: userRole,
          phone: normalizedPhone,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error(`[verify-otp] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ message: "Internal server error", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
