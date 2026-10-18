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
      .select("id, ebook_id, amount_paise, currency, payment_status, razorpay_order_id, razorpay_payment_id")
      .eq("razorpay_order_id", orderId).maybeSingle();
    if (lookupError || !orderRow) return reply({ error: "Order not found." }, 404);

    // Validate the Razorpay checkout signature before any state change or download link creation.
    const expected = await hmacSha256(keySecret, orderId + "|" + paymentId);
    if (!constantTimeEqual(expected, signature)) return reply({ error: "Payment signature is invalid." }, 400);

    // A payment ID must never be attached to a different order.
    const { data: paymentUsed, error: paymentUsedError } = await supabase.from("ebook_orders")
      .select("id, razorpay_order_id")
      .eq("razorpay_payment_id", paymentId).maybeSingle();
    if (paymentUsedError) return reply({ error: "Could not validate payment record." }, 500);
    if (paymentUsed && paymentUsed.id !== orderRow.id) {
      return reply({ error: "This payment is already associated with another order." }, 409);
    }

    // Confirm the payment directly with Razorpay; never trust the browser's success callback alone.
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

    // If this exact payment was already recorded for this order, allow safe re-delivery
    // after a transient download-link failure. A different payment cannot reuse a paid order.
    if (orderRow.payment_status === "paid" && orderRow.razorpay_payment_id !== paymentId) {
      return reply({ error: "This order was paid using a different payment. Contact support if you need help." }, 409);
    }
    if (orderRow.payment_status !== "pending" && orderRow.payment_status !== "paid") {
      return reply({ error: "This order is not eligible for fulfillment." }, 409);
    }

    const { data: ebook, error: ebookError } = await supabase.from("ebooks")
      .select("id, title, pdf_path").eq("id", orderRow.ebook_id).maybeSingle();
    if (ebookError || !ebook || !ebook.pdf_path) {
      return reply({ error: "The ebook file is not configured. Contact store support." }, 500);
    }

    // Record payment once. Conditional update protects against concurrent verification attempts.
    if (orderRow.payment_status === "pending") {
      const { data: updated, error: updateError } = await supabase.from("ebook_orders")
        .update({ payment_status: "paid", razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
        .eq("id", orderRow.id).eq("payment_status", "pending").select("id").maybeSingle();
      if (updateError) {
        console.error("Payment record update failed:", updateError.message);
        return reply({ error: "Could not record the verified payment. Contact support; do not pay again." }, 500);
      }
      if (!updated) {
        // Another concurrent request may have completed this exact payment. Re-read before deciding.
        const { data: latest, error: latestError } = await supabase.from("ebook_orders")
          .select("payment_status, razorpay_payment_id").eq("id", orderRow.id).maybeSingle();
        if (latestError || latest?.payment_status !== "paid" || latest?.razorpay_payment_id !== paymentId) {
          return reply({ error: "Payment is verified, but the order record needs support review. Do not pay again." }, 409);
        }
      }
    }

    // Create the temporary link after recording payment. If this fails, retrying the same
    // verified payment can safely issue a fresh link without charging the customer again.
    const { data: signed, error: signError } = await supabase.storage.from("ebooks")
      .createSignedUrl(ebook.pdf_path, 600);
    if (signError || !signed?.signedUrl) {
      console.error("Signed URL creation failed:", signError?.message ?? "unknown");
      return reply({ error: "Payment is recorded, but the download link could not be created. Contact support with your payment ID." }, 500);
    }
    return reply({ verified: true, ebook_title: ebook.title, download_url: signed.signedUrl, expires_in_seconds: 600 });
  } catch (error) {
    console.error("Verification error:", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Unexpected verification error." }, 500);
  }
});