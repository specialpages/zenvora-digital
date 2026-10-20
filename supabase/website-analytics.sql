-- Zenvora Digital privacy-conscious website analytics.
-- Run this file in Supabase Dashboard > SQL Editor once.
create table if not exists public.website_pageviews (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  page_path text not null,
  referrer_host text,
  created_at timestamptz not null default now()
);
create index if not exists website_pageviews_created_at_idx on public.website_pageviews (created_at desc);
create index if not exists website_pageviews_visitor_created_idx on public.website_pageviews (visitor_id, created_at desc);
alter table public.website_pageviews enable row level security;
revoke all on public.website_pageviews from anon, authenticated;
grant insert on public.website_pageviews to anon, authenticated;
grant select on public.website_pageviews to authenticated;
drop policy if exists "Public can record page views" on public.website_pageviews;
create policy "Public can record page views"
  on public.website_pageviews for insert to anon, authenticated
  with check (
    page_path is not null and length(page_path) between 1 and 300
    and visitor_id is not null
    and (referrer_host is null or length(referrer_host) <= 255)
  );
drop policy if exists "Signed-in admins can read page views" on public.website_pageviews;
create policy "Signed-in admins can read page views"
  on public.website_pageviews for select to authenticated
  using (auth.uid() is not null);
