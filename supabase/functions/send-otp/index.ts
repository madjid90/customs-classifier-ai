import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate a 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Normalize phone to E.164 format
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  
  // Handle Moroccan numbers
  if (cleaned.startsWith("0")) {
    cleaned = "212" + cleaned.slice(1);
  }
  if (!cleaned.startsWith("212") && cleaned.length === 9) {
    cleaned = "212" + cleaned;
  }
  
  return "+" + cleaned;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone } = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ message: "Phone number is required", code: "MISSING_PHONE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    console.log(`[send-otp] Processing OTP request for phone: ${normalizedPhone}`);

    // Validate phone format (E.164)
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    if (!phoneRegex.test(normalizedPhone)) {
      return new Response(
        JSON.stringify({ message: "Invalid phone format", code: "INVALID_PHONE" }),
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
      .eq("phone", normalizedPhone)
      .gte("created_at", oneHourAgo);

    if (recentCount && recentCount >= 5) {
      console.log(`[send-otp] Rate limit exceeded for phone: ${normalizedPhone}`);
      return new Response(
        JSON.stringify({ message: "Too many requests. Please wait before requesting a new code.", code: "RATE_LIMITED" }),
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
      .eq("phone", normalizedPhone)
      .eq("verified", false);

    // Store new OTP
    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({
        phone: normalizedPhone,
        code: otp,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error(`[send-otp] Error storing OTP:`, insertError);
      return new Response(
        JSON.stringify({ message: "Failed to generate OTP", code: "INTERNAL_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // In production, integrate with SMS provider (Twilio, etc.)
    // For development, log the OTP
    console.log(`[send-otp] OTP for ${normalizedPhone}: ${otp} (expires: ${expiresAt.toISOString()})`);

    // Return success
    return new Response(
      JSON.stringify({
        ok: true,
        expires_in: 300, // 5 minutes in seconds
        // DEV ONLY: Include OTP in response for testing
        // Remove this in production!
        _dev_otp: otp,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`[send-otp] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ message: "Internal server error", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
