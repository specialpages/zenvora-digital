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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
    const email = typeof body.customer_email === "string" ? body.customer_email.trim().toLowerCase() : "";

    if (!orderId || orderId.length > 100 || !paymentId || paymentId.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return reply({ error: "Enter a valid order ID, payment ID and email address." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const dbKey = Deno.env.get("ZENVORA_DB_SECRET");
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!url || !dbKey || !keyId || !keySecret) {
      return reply({ error: "Recovery service is not configured." }, 500);
    }

    const supabase = createClient(url, dbKey, { auth: { persistSession: false } });
    const { data: order, error } = await supabase.from("ebook_orders")
      .select("id, ebook_id, customer_email, amount_paise, currency, payment_status, razorpay_order_id, razorpay_payment_id")
      .eq("razorpay_order_id", orderId)
      .eq("razorpay_payment_id", paymentId)
      .maybeSingle();

    // Use the same generic response for mismatched details to avoid disclosing order records.
    if (error || !order || order.customer_email.toLowerCase() !== email || order.payment_status !== "paid") {
      return reply({ error: "We couldn't verify a paid order with those details. Check them or contact support." }, 404);
    }

    const auth = btoa(keyId + ":" + keySecret);
    const paymentResponse = await fetch(
      "https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId),
      { headers: { Authorization: "Basic " + auth } },
    );
    const payment = await paymentResponse.json();
    if (!paymentResponse.ok) return reply({ error: "Could not verify the payment with Razorpay. Please try later." }, 502);

    if (payment.order_id !== orderId || payment.status !== "captured" ||
        Number(payment.amount) !== Number(order.amount_paise) || payment.currency !== order.currency) {
      return reply({ error: "This payment could not be verified for download." }, 403);
    }

    const { data: ebook, error: ebookError } = await supabase.from("ebooks")
      .select("title, pdf_path").eq("id", order.ebook_id).maybeSingle();
    if (ebookError || !ebook?.pdf_path) return reply({ error: "The ebook file is unavailable. Contact support." }, 500);

    const { data: signed, error: signError } = await supabase.storage.from("ebooks")
      .createSignedUrl(ebook.pdf_path, 600);
    if (signError || !signed?.signedUrl) {
      console.error("Recovery signed URL failed:", signError?.message ?? "unknown");
      return reply({ error: "We verified your purchase but couldn't create a download link. Please try again later." }, 500);
    }

    return reply({ recovered: true, ebook_title: ebook.title, download_url: signed.signedUrl, expires_in_seconds: 600 });
  } catch (error) {
    console.error("Recovery error:", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Unexpected recovery error." }, 500);
  }
});