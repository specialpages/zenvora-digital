import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://specialpages.in",
  "https://www.specialpages.in",
  "https://specialpages.github.io",
]);
function corsHeadersFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://specialpages.in",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function reply(data: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(data), { status, headers: req ? corsHeadersFor(req) : corsHeadersFor(new Request("https://specialpages.in")) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, req);

  try {
    const body = await req.json();
    const slug = body.ebook_id;
    const name = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const email = typeof body.customer_email === "string" ? body.customer_email.trim() : "";
    if (typeof slug !== "string" || !slug || slug.length > 150 ||
        !name || name.length > 120 || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Valid ebook, customer name and email are required." }, 400, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const dbKey = Deno.env.get("ZENVORA_DB_SECRET");
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!supabaseUrl || !dbKey || !keyId || !keySecret) {
      console.error("Required payment environment variables are missing.");
      return reply({ error: "Payment service is not configured." }, 500, req);
    }

    const supabase = createClient(supabaseUrl, dbKey, { auth: { persistSession: false } });
    const { data: ebook, error } = await supabase.from("ebooks")
      .select("id, slug, title, price_paise, is_active")
      .eq("slug", slug).eq("is_active", true).maybeSingle();
    if (error) {
      console.error("Ebook lookup failed:", error.message);
      return reply({ error: "Unable to retrieve ebook details." }, 500, req);
    }
    if (!ebook) return reply({ error: "Ebook not found or unavailable." }, 404, req);

    const amount = Number(ebook.price_paise);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      return reply({ error: "Invalid ebook price. Minimum price is ₹1." }, 400, req);
    }

    const auth = btoa(keyId + ":" + keySecret);
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount, currency: "INR", receipt: crypto.randomUUID(),
        notes: { ebook_id: ebook.id, ebook_slug: ebook.slug, customer_name: name, customer_email: email },
      }),
    });
    const razorOrder = await r.json();
    if (!r.ok) {
      console.error("Razorpay order creation failed:", razorOrder.error?.code ?? "unknown");
      return reply({ error: "Razorpay could not create the payment order." }, 502, req);
    }

    const { error: insertError } = await supabase.from("ebook_orders").insert({
      ebook_id: ebook.id, customer_name: name, customer_email: email,
      amount_paise: amount, currency: "INR", payment_status: "pending",
      razorpay_order_id: razorOrder.id,
    });
    if (insertError) {
      console.error("Could not save pending order:", insertError.message);
      return reply({ error: "Could not record the order. Please contact support before retrying." }, 500, req);
    }

    return reply({ order_id: razorOrder.id, amount: razorOrder.amount, currency: razorOrder.currency, key_id: keyId, ebook_title: ebook.title });
  } catch (error) {
    console.error("Order function error:", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Unexpected server error." }, 500, req);
  }
});