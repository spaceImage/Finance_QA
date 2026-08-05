-- ============================================================
-- 보험약관 RAG용 pgvector 스키마 (Supabase)
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행하세요.
-- text-embedding-3-small 모델 기준 임베딩 차원 = 1536
-- ============================================================

-- 1. pgvector 확장 활성화
create extension if not exists vector;

-- 2. 문서(청크) 테이블
--    여러 인물(task_name)의 데이터를 한 테이블에 같이 저장하고,
--    metadata->>'task_name' 으로 구분/필터링합니다.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  content text,
  metadata jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- 3. 검색/필터 성능을 위한 인덱스
--    - task_name 등 메타데이터 컨테인먼트(@>) 검색용 GIN 인덱스
create index if not exists documents_metadata_gin_idx
  on documents using gin (metadata);

--    - 벡터 근사 최근접 검색용 IVFFLAT 인덱스 (코사인 거리 기준)
--      데이터가 어느 정도 쌓인 뒤(수백~수천 건) 아래를 실행하는 걸 권장합니다.
--      lists 값은 대략 sqrt(전체 행수) 정도로 나중에 조정 가능합니다.
create index if not exists documents_embedding_idx
  on documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. LangChain SupabaseVectorStore가 호출하는 유사도 검색 RPC 함수
--    filter는 jsonb 컨테인먼트(@>)로 매칭합니다.
--    예: filter := '{"task_name": "jang"}'::jsonb  →  metadata->>'task_name' = 'jang' 인 행만 검색
create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default null,
  filter jsonb default '{}'
) returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where documents.metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 5. 세션 관리 테이블 (sessions)
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  task_name text not null,
  counselor_id text,
  status text not null default 'ACTIVE',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. RAG 오케스트레이션 단계별 감사 로그 테이블 (audit_logs)
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  step_name text not null,
  status text not null default 'SUCCESS',
  input_payload jsonb default '{}'::jsonb,
  output_payload jsonb default '{}'::jsonb,
  execution_time_ms integer default 0,
  created_at timestamptz not null default now()
);

-- 7. Audit Log & Sessions 인덱스
create index if not exists sessions_task_name_idx on sessions (task_name);
create index if not exists audit_logs_session_id_idx on audit_logs (session_id);
create index if not exists audit_logs_step_name_idx on audit_logs (step_name);

