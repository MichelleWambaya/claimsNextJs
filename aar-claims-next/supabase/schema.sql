-- AAR Claims Forensic Audit Platform — Supabase schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Every statement is idempotent (IF NOT EXISTS) so it's safe to re-run.

create extension if not exists pgcrypto;

-- Supabase Auth already provides auth.users — we extend it with a profile
-- row for role (admin/analyst) rather than duplicating auth entirely.
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    role text not null default 'analyst' check (role in ('admin', 'analyst')),
    created_at timestamptz not null default now()
);

create table if not exists public.audit_sessions (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
);

create table if not exists public.source_files (
    id uuid primary key default gen_random_uuid(),
    audit_session_id uuid not null references public.audit_sessions(id) on delete cascade,
    file_name text not null,
    source_type text not null default 'manual_upload', -- manual_upload | link_sync | ms_oauth_sync
    source_ref text,
    status text not null default 'pending', -- pending | parsing | merged | error
    row_count integer not null default 0,
    total_rows_expected integer,
    schema_issues jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One row per claim line item. Kept intentionally flat (not fully
-- normalized against the 57-column source) so the rule engine can query
-- it directly without joins — mirrors the ClaimRow shape from the prior
-- FastAPI version.
create table if not exists public.claim_rows (
    id uuid primary key default gen_random_uuid(),
    audit_session_id uuid not null references public.audit_sessions(id) on delete cascade,
    source_file_id uuid references public.source_files(id) on delete cascade,
    member_id text,
    policy_number text,
    claim_code text,
    claim_status text,
    provider text,
    provider_affiliation text,
    category text,             -- item_benefit / plan category, used for IQR grouping
    diagnosis_type text,
    diagnosis_name text,
    invoice_number text,
    product_name text,
    visit_date date,
    amount numeric,
    approved_amount numeric,
    denial_code text,
    raw jsonb,                 -- full original row, for drill-down detail
    created_at timestamptz not null default now()
);

create index if not exists idx_claim_rows_session on public.claim_rows(audit_session_id);
create index if not exists idx_claim_rows_member on public.claim_rows(audit_session_id, member_id);
create index if not exists idx_claim_rows_visit_date on public.claim_rows(audit_session_id, visit_date);
create index if not exists idx_claim_rows_category on public.claim_rows(audit_session_id, category);

create table if not exists public.flags (
    id uuid primary key default gen_random_uuid(),
    audit_session_id uuid not null references public.audit_sessions(id) on delete cascade,
    claim_row_id uuid references public.claim_rows(id) on delete cascade,
    flag_type text not null check (flag_type in
        ('item_duplicate', 'claim_duplicate', 'non_payable', 'pricing_anomaly',
         'invalid_member_policy', 'diagnosis_gap', 'overpaid_claim')),
    group_id text,
    reason text,
    detail jsonb,
    review_status text default 'unreviewed', -- unreviewed | confirmed | dismissed
    reviewed_by uuid references public.profiles(id),
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_flags_session on public.flags(audit_session_id);
create index if not exists idx_flags_type on public.flags(audit_session_id, flag_type);

create table if not exists public.rule_config (
    audit_session_id uuid primary key references public.audit_sessions(id) on delete cascade,
    config jsonb not null,
    updated_by uuid references public.profiles(id),
    updated_at timestamptz not null default now()
);

create table if not exists public.rule_config_history (
    id bigserial primary key,
    audit_session_id uuid not null references public.audit_sessions(id) on delete cascade,
    changed_by uuid references public.profiles(id),
    previous_config jsonb,
    new_config jsonb,
    changed_at timestamptz not null default now()
);

create table if not exists public.non_payable_keywords (
    id bigserial primary key,
    category text not null,
    keyword text not null,
    added_by uuid references public.profiles(id),
    added_at timestamptz not null default now(),
    unique (category, keyword)
);

insert into public.non_payable_keywords (category, keyword)
select * from (values
    ('cosmetics', 'cosmetic'), ('cosmetics', 'botox'), ('cosmetics', 'filler'),
    ('plastic_surgery', 'plastic surgery'), ('plastic_surgery', 'liposuction'),
    ('beauty_treatment', 'beauty treatment'), ('beauty_treatment', 'spa'),
    ('nutritional_supplements', 'supplement'), ('nutritional_supplements', 'multivitamin'),
    ('herbal_treatment', 'herbal'), ('herbal_treatment', 'traditional medicine'),
    ('contact_lenses_laser_eye', 'contact lens'), ('contact_lenses_laser_eye', 'laser eye'),
    ('hrt', 'hormone replacement'), ('hrt', 'hrt'),
    ('orthodontics', 'orthodont'), ('orthodontics', 'braces'),
    ('epidemics_pandemics', 'pandemic'), ('epidemics_pandemics', 'epidemic')
) as v(category, keyword)
where not exists (select 1 from public.non_payable_keywords limit 1);

-- Generated reports (PPTX-equivalent presentation snapshot, PDF-equivalent
-- printable view, and XLSX exports) — stored as rows + a Supabase Storage
-- object key, so past reports remain browsable, not just the latest.
create table if not exists public.generated_reports (
    id uuid primary key default gen_random_uuid(),
    audit_session_id uuid not null references public.audit_sessions(id) on delete cascade,
    generated_by uuid references public.profiles(id),
    report_type text not null check (report_type in ('presentation', 'xlsx', 'pdf_view')),
    category_filter text,
    range_from date,
    range_to date,
    summary jsonb not null,       -- KPI counts + total flagged amount, computed at generation time
    storage_path text,            -- Supabase Storage object key, for xlsx/pdf exports
    status text not null default 'ready',
    created_at timestamptz not null default now()
);

create index if not exists idx_reports_session on public.generated_reports(audit_session_id);

-- Delegated OAuth tokens, one row per user who connects their own
-- OneDrive/SharePoint account.
create table if not exists public.ms_oauth_tokens (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    access_token text not null,
    refresh_token text not null,
    expires_at timestamptz not null,
    scope text,
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Short-lived OAuth state tokens (CSRF protection for the delegated
-- Microsoft sign-in flow) — a state row is written on /connect and
-- consumed (then deleted) on /callback, tying the redirect back to the
-- right user without needing a signed JWT.
create table if not exists public.ms_oauth_states (
    state uuid primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.ms_oauth_states enable row level security;
drop policy if exists "own_state_only" on public.ms_oauth_states;
create policy "own_state_only" on public.ms_oauth_states
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Row Level Security: every table is readable/writable only by
-- authenticated users. Kept permissive across all authenticated users
-- for now (single-org internal tool) rather than per-row ownership —
-- tighten later with policies scoped to audit_sessions.created_by if
-- multiple orgs ever share one Supabase project.
alter table public.profiles enable row level security;
alter table public.audit_sessions enable row level security;
alter table public.source_files enable row level security;
alter table public.claim_rows enable row level security;
alter table public.flags enable row level security;
alter table public.rule_config enable row level security;
alter table public.rule_config_history enable row level security;
alter table public.non_payable_keywords enable row level security;
alter table public.generated_reports enable row level security;
alter table public.ms_oauth_tokens enable row level security;

do $$
declare
    t text;
begin
    for t in select unnest(array[
        'profiles', 'audit_sessions', 'source_files', 'claim_rows', 'flags',
        'rule_config', 'rule_config_history', 'non_payable_keywords', 'generated_reports'
    ])
    loop
        execute format(
            'drop policy if exists "authenticated_all" on public.%I;
             create policy "authenticated_all" on public.%I
               for all using (auth.role() = ''authenticated'')
               with check (auth.role() = ''authenticated'');',
            t, t
        );
    end loop;
end $$;

-- ms_oauth_tokens: users may only see/manage their own token row.
drop policy if exists "own_token_only" on public.ms_oauth_tokens;
create policy "own_token_only" on public.ms_oauth_tokens
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create a profile row when someone signs up (first user = admin).
create or replace function public.handle_new_user()
returns trigger as $$
declare
    is_first boolean;
begin
    select count(*) = 0 into is_first from public.profiles;
    insert into public.profiles (id, email, display_name, role)
    values (
        new.id, new.email,
        coalesce(new.raw_user_meta_data->>'display_name', new.email),
        case when is_first then 'admin' else 'analyst' end
    );
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
