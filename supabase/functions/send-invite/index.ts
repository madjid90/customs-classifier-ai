import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { authenticateRequest, createServiceClient, getUserFromToken } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Phone validation schema
const PhoneSchema = z.string().refine(
  (val) => {
    const cleaned = val.replace(/[\s\-\(\)]/g, "");
    return /^\+[1-9]\d{9,14}$/.test(cleaned);
  },
  { message: "Invalid phone number format" }
);

const InviteSchema = z.object({
  phone: PhoneSchema,
  role: z.enum(["admin", "manager", "agent"]),
  inviter_name: z.string().optional(),
});

// Normalize phone number to E.164 format
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "");
}

// Send SMS via Twilio
async function sendSmsViaTwilio(to: string, message: string): Promise<{ success: boolean; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromPhone) {
    console.error("[send-invite] Twilio credentials not configured");
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
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[send-invite] Twilio error:", data);
      return { success: false, error: data.message || "Failed to send SMS" };
    }

    console.log(`[send-invite] SMS sent successfully, SID: ${data.sid}`);
    return { success: true };
  } catch (error) {
    console.error("[send-invite] Twilio request failed:", error);
    return { success: false, error: "SMS service unavailable" };
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with custom JWT
    const authResult = await authenticateRequest(req, { requireRole: ["admin", "manager"] });
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user } = authResult.data;
    const supabaseAdmin = createServiceClient();

    // Parse and validate request body
    const body = await req.json();
    const validation = InviteSchema.safeParse(body);

    if (!validation.success) {
      return new Response(
        JSON.stringify({ 
          error: "Données invalides", 
          code: "VALIDATION_ERROR",
          details: validation.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { phone, role, inviter_name } = validation.data;
    const normalizedPhone = normalizePhone(phone);

    console.log(`[send-invite] Processing invite for ${normalizedPhone} with role ${role}`);

    // Check if user already exists
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("phone", normalizedPhone)
      .single();

    if (existingProfile) {
      // User exists - just update/add their role
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: existingProfile.user_id, role }, { onConflict: "user_id" });

      if (roleError) {
        console.error("[send-invite] Error updating role:", roleError);
        return new Response(
          JSON.stringify({ error: "Erreur lors de la mise à jour du rôle", code: "ROLE_ERROR" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Send notification SMS
      const roleLabels: Record<string, string> = {
        admin: "Administrateur",
        manager: "Manager",
        agent: "Agent",
      };

      const notifyMessage = `Votre rôle a été mis à jour: ${roleLabels[role]}. Connectez-vous à l'application pour accéder à vos nouvelles permissions.`;
      await sendSmsViaTwilio(normalizedPhone, notifyMessage);

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Utilisateur existant - rôle mis à jour",
          already_exists: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // New user - store pending invitation
    const { error: inviteError } = await supabaseAdmin
      .from("pending_invites")
      .upsert(
        {
          phone: normalizedPhone,
          role,
          invited_by: user.id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        },
        { onConflict: "phone" }
      );

    // Note: If table doesn't exist, we'll just send the invite anyway
    if (inviteError) {
      console.warn("[send-invite] Could not store pending invite (table may not exist):", inviteError);
    }

    // Compose invitation SMS
    const roleLabels: Record<string, string> = {
      admin: "Administrateur",
      manager: "Manager",
      agent: "Agent",
    };

    const inviterText = inviter_name ? ` par ${inviter_name}` : "";
    const inviteMessage = `Vous êtes invité${inviterText} à rejoindre l'application de classification douanière en tant que ${roleLabels[role]}. Connectez-vous avec ce numéro pour créer votre compte.`;

    // Send invitation SMS
    const smsResult = await sendSmsViaTwilio(normalizedPhone, inviteMessage);

    if (!smsResult.success) {
      return new Response(
        JSON.stringify({ 
          error: smsResult.error || "Échec d'envoi du SMS", 
          code: "SMS_FAILED" 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-invite] Invitation sent to ${normalizedPhone}`);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Invitation envoyée par SMS",
        already_exists: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[send-invite] Unexpected error:", error);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
