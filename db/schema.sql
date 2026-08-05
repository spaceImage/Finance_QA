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

-- 5. (선택) 특정 인물(task_name)의 데이터를 한 번에 지우고 싶을 때 사용할 헬퍼
--    step_3.py가 재실행 시 자동으로 아래와 동일한 delete를 수행하므로 수동 실행은 보통 불필요합니다.
-- delete from documents where metadata->>'task_name' = 'jang';
