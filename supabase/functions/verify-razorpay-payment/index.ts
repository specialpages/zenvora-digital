import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://specialpages.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    if ([orderId, paymentId, signature].some(v => typeof v !== "string" || !v || v.length > 200)) {
      return reply({ error: "Payment details are incomplete." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const dbKey = Deno.env.get("ZENVORA_DB_SECRET");
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!url || !dbKey || !keyId || !keySecret) return reply({ error: "Payment service is not configured." }, 500);

    const supabase = createClient(url, dbKey, { auth: { persistSession: false } });
    const { data: orderRow, error: lookupError } = await supabase.from("ebook_orders")
      .select("id, ebook_id, amount_paise, currency, payment_status, razorpay_order_id")
      .eq("razorpay_order_id", orderId).maybeSingle();
    if (lookupError || !orderRow) return reply({ error: "Order not found." }, 404);
    if (orderRow.payment_status === "paid") {
      return reply({ error: "This order has already been processed. Contact support if you need your download link again." }, 409);
    }

    const expected = await hmacSha256(keySecret, orderId + "|" + paymentId);
    if (!constantTimeEqual(expected, signature)) return reply({ error: "Payment signature is invalid." }, 400);

    const auth = btoa(keyId + ":" + keySecret);
    const paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
      headers: { Authorization: "Basic " + auth },
    });
    const payment = await paymentResponse.json();
    if (!paymentResponse.ok) return reply({ error: "Could not verify payment with Razorpay." }, 502);
    if (payment.order_id !== orderId || payment.status !== "captured" ||
        Number(payment.amount) !== Number(orderRow.amount_paise) ||
        payment.currency !== orderRow.currency) {
      return reply({ error: "Payment is not captured or does not match this order." }, 400);
    }

    const { data: ebook, error: ebookError } = await supabase.from("ebooks")
      .select("id, title, pdf_path, is_active").eq("id", orderRow.ebook_id).maybeSingle();
    if (ebookError || !ebook || !ebook.pdf_path) return reply({ error: "The ebook file is not configured. Contact store support." }, 500);

    const { data: updated, error: updateError } = await supabase.from("ebook_orders")
      .update({ payment_status: "paid", razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
      .eq("id", orderRow.id).eq("payment_status", "pending").select("id").maybeSingle();
    if (updateError || !updated) return reply({ error: "Could not record the verified payment. Contact support; do not pay again." }, 500);

    const { data: signed, error: signError } = await supabase.storage.from("ebooks")
      .createSignedUrl(ebook.pdf_path, 600);
    if (signError || !signed?.signedUrl) {
      console.error("Signed URL creation failed:", signError?.message ?? "unknown");
      return reply({ error: "Payment was verified, but the download link could not be created. Contact support with your payment ID." }, 500);
    }
    return reply({ verified: true, ebook_title: ebook.title, download_url: signed.signedUrl, expires_in_seconds: 600 });
  } catch (error) {
    console.error("Verification error:", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Unexpected verification error." }, 500);
  }
});