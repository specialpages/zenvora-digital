-- Run only in the separate zenvora-digital Supabase project.
-- IMPORTANT: Create your admin user in Authentication first and disable public sign-ups.
-- These policies treat every authenticated account as an admin; never enable public sign-ups.

GRANT SELECT ON public.ebooks TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ebooks TO authenticated;

DROP POLICY IF EXISTS "Admins manage ebooks" ON public.ebooks;
CREATE POLICY "Admins manage ebooks" ON public.ebooks
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Keep the ebooks bucket private. Authenticated sessions can upload and manage its files.
DROP POLICY IF EXISTS "Admins manage private ebook files" ON storage.objects;
CREATE POLICY "Admins manage private ebook files" ON storage.objects
FOR ALL TO authenticated USING (bucket_id = 'ebooks') WITH CHECK (bucket_id = 'ebooks');

-- No public policies for ebook_orders. Payment and order writes must use secure server functions.
