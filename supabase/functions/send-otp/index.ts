import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Domaines autorisés pour CORS
const ALLOWED_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed) || 
    origin.endsWith(".lovable.app") || 
    origin.includes("localhost");
  
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
  };
}

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

// Send SMS via Twilio
async function sendSmsViaTwilio(to: string, message: string): Promise<{ success: boolean; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromPhone) {
    console.error("[send-otp] Twilio credentials not configured");
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
      console.error("[send-otp] Twilio error:", data);
      return { success: false, error: data.message || "Failed to send SMS" };
    }

    console.log(`[send-otp] SMS sent successfully, SID: ${data.sid}`);
    return { success: true };
  } catch (error) {
    console.error("[send-otp] Twilio request failed:", error);
    return { success: false, error: "SMS service unavailable" };
  }
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

    // Send SMS via Twilio
    const smsMessage = `Votre code de vérification est: ${otp}. Ce code expire dans 5 minutes.`;
    const smsResult = await sendSmsViaTwilio(normalizedPhone, smsMessage);

    if (!smsResult.success) {
      console.error(`[send-otp] Failed to send SMS:`, smsResult.error);
      // Delete the OTP since SMS failed
      await supabase
        .from("otp_codes")
        .delete()
        .eq("phone", normalizedPhone)
        .eq("code", otp);
      
      return new Response(
        JSON.stringify({ message: smsResult.error || "Failed to send SMS", code: "SMS_FAILED" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-otp] OTP sent to ${normalizedPhone} (expires: ${expiresAt.toISOString()})`);

    // Return success
    return new Response(
      JSON.stringify({
        ok: true,
        expires_in: 300, // 5 minutes in seconds
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
