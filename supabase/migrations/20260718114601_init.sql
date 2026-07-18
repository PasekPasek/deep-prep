-- DeepPrep initial schema.
--
-- Covers the full CLAUDE.md §4 schema in one migration, including the tables that
-- Layer 1 does not use yet (runs, scratchpad). They are created now so the
-- multi-agent split in Layer 4 needs no schema rework.
--
-- Two deliberate departures from the §4 draft, both documented in §2:
--   * HNSW instead of ivfflat for the vector indexes (current Supabase guidance
--     for read-heavy semantic search).
--   * sections carries a `part` column so a heading split across several rows
--     still has a stable idempotency key for re-ingest.

create extension if not exists vector;

-- ===== Corpus (hybrid retrieval) =====

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,           -- "tech-interview-handbook"
  kind text not null,                  -- 'github_repo' | 'book' | 'own_notes'
  url text,
  license text not null,               -- 'mit' | 'cc-by-sa' | 'proprietary-personal' | 'own'
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade,
  path text not null,                  -- "react.md"
  title text,
  ord int,                             -- order within source
  unique (source_id, path)
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  heading_path text[] not null,        -- ['React', 'Hooks', 'useEffect']
  -- A heading whose body exceeds the token ceiling is split into several rows;
  -- `part` keeps (document, heading_path, part) unique so re-ingest updates in
  -- place instead of accumulating duplicates.
  part int not null default 0,
  content text not null,               -- full section text (200-800 tokens target)
  ord int,
  embedding vector(1536),              -- per SECTION, not per fixed-size chunk
  unique (document_id, heading_path, part)
);
create index on sections using hnsw (embedding vector_cosine_ops);

-- ===== Offers & Cards (global pool, N:M) =====

create table offers (
  id uuid primary key default gen_random_uuid(),
  input_kind text not null,            -- 'url' | 'screenshot'
  raw_input text,                      -- URL or storage path to image
  company text, role text, seniority text,
  extracted jsonb,                     -- ExtractedOffer (Zod-validated)
  created_at timestamptz default now()
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,           -- 'react-hooks', 'rag-evals'
  name text not null
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id),
  kind text not null,                  -- 'concept' | 'interview_question' | 'coding_task'
  front text not null,
  back text not null,
  provenance jsonb not null,           -- [{kind, ref}]
  embedding vector(1536),              -- dedup + semantic library search
  status text not null default 'active',  -- 'active' | 'suspended'
  created_at timestamptz default now()
);
create index on cards using hnsw (embedding vector_cosine_ops);

create table card_offers (
  card_id uuid references cards(id) on delete cascade,
  offer_id uuid references offers(id) on delete cascade,
  primary key (card_id, offer_id)
);

-- ===== FSRS reviews (global per card) =====

create table review_state (
  card_id uuid primary key references cards(id) on delete cascade,
  due timestamptz not null,
  stability real, difficulty real,
  reps int default 0, lapses int default 0,
  state int not null default 0,        -- ts-fsrs State enum
  last_review timestamptz
);
-- The daily queue is "due <= now() order by due" — index it.
create index on review_state (due);

create table review_log (
  id bigserial primary key,
  card_id uuid references cards(id) on delete cascade,
  rating int not null,                 -- 1..4 (Again/Hard/Good/Easy)
  reviewed_at timestamptz default now(),
  elapsed_days real, scheduled_days real
);

-- ===== Agent runtime: blackboard pattern =====

create table runs (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references offers(id),
  status text not null default 'pending',
    -- 'pending'|'extracting'|'planning'|'researching'|'writing'|'critiquing'
    -- |'awaiting_approval'|'done'|'failed'
  current_step jsonb,                  -- e.g. {"phase":"researching","topicIdx":3}
  plan jsonb,                          -- Plan (Zod)
  draft_cards jsonb,                   -- DraftCard[] awaiting HITL
  error text,
  cost_usd numeric default 0,          -- accumulated, enforced against budget
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on runs (status);

create table scratchpad (
  id bigserial primary key,
  run_id uuid references runs(id) on delete cascade,
  topic_slug text not null,
  content text not null,               -- researcher notes (synthesized, not raw dumps)
  provenance jsonb not null,
  created_at timestamptz default now()
);
create index on scratchpad (run_id, topic_slug);

-- Keep runs.updated_at honest without every writer remembering to set it.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger runs_set_updated_at
  before update on runs
  for each row execute function set_updated_at();

-- ===== Retrieval functions (called via supabase-js .rpc()) =====

-- Classic RAG over section embeddings. Returns provenance-ready rows: the caller
-- gets heading_path + source name without a second query.
create or replace function match_sections(
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  section_id uuid,
  content text,
  heading_path text[],
  document_path text,
  document_title text,
  source_name text,
  similarity float
)
language sql
stable
as $$
  select
    s.id,
    s.content,
    s.heading_path,
    d.path,
    d.title,
    src.name,
    1 - (s.embedding <=> query_embedding) as similarity
  from sections s
  join documents d on d.id = s.document_id
  join sources src on src.id = d.source_id
  where s.embedding is not null
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

-- Dedup support for the Critic (Layer 2): nearest existing cards for a draft.
create or replace function match_cards(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  card_id uuid,
  front text,
  back text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.front,
    c.back,
    1 - (c.embedding <=> query_embedding) as similarity
  from cards c
  where c.embedding is not null
    and c.status = 'active'
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ===== RLS =====
-- All access is server-side through the service-role key, which bypasses RLS.
-- Enabling RLS with no policies therefore denies anon/authenticated clients
-- entirely — defense in depth in case an anon key ever reaches the browser.

alter table sources       enable row level security;
alter table documents     enable row level security;
alter table sections      enable row level security;
alter table offers        enable row level security;
alter table topics        enable row level security;
alter table cards         enable row level security;
alter table card_offers   enable row level security;
alter table review_state  enable row level security;
alter table review_log    enable row level security;
alter table runs          enable row level security;
alter table scratchpad    enable row level security;
