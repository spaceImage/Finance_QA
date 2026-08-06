# [3단계: 임베딩/벡터DB 적재] final_output JSON을 페이지 단위 청크로 쪼개 OpenAI로 임베딩한 뒤,
# Supabase(pgvector)의 documents 테이블에 저장합니다. 재실행해도 중복 적재되지 않도록
# 저장 전에 이 인물(task_name)의 기존 벡터를 먼저 지웁니다.
import os
import json
from dotenv import load_dotenv
from langchain_core.documents import Document
from rag_common import get_embeddings, get_supabase_client, clear_task_documents, DOCUMENTS_TABLE, MATCH_FUNCTION, TASKS_DIR
from langchain_community.vectorstores import SupabaseVectorStore

# .env 로드
load_dotenv()

def run_step_3(task_folder_name: str, overlap_chars: int = 400):
    task_dir = os.path.join(TASKS_DIR, task_folder_name)
    final_json_path = os.path.join(task_dir, "final_output", f"{task_folder_name}_final.json")

    # API 키 검증
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\n❌ [오류] OPENAI_API_KEY를 찾을 수 없습니다.")
        print("👉 프로젝트 최상위 경로의 '.env' 파일에 OPENAI_API_KEY를 설정해주세요.")
        return

    # Supabase 접속 정보 검증
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("\n❌ [오류] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 찾을 수 없습니다.")
        print("👉 '.env' 파일에 Supabase 프로젝트 정보를 설정해주세요. (supabase/schema.sql 먼저 실행 필요)")
        return

    # 최종 JSON 검증
    if not os.path.exists(final_json_path):
        print(f"\n❌ [오류] 최종 JSON 파일을 찾을 수 없습니다: {final_json_path}")
        print("👉 먼저 'step_2'를 실행하여 최종 JSON 합본을 만들어주세요.")
        return

    print(f"\n🚀 [{task_folder_name}] 최종 JSON 기반 임베딩 시작: {os.path.basename(final_json_path)}")

    with open(final_json_path, "r", encoding="utf-8") as f:
        final_data = json.load(f)

    sections = final_data.get("sections", [])
    documents = []

    # 섹션 및 페이지 순회
    for section in sections:
        meta = section["metadata"]
        section_title = meta.get("section_title", "약관 내용")
        total_section_pages = meta.get("total_section_pages", 0)
        source_pdf = meta.get("source_pdf", "raw_policy.pdf")
        pages = section.get("pages", [])

        prev_text = ""
        for page_info in pages:
            page_num = page_info["page_number"]
            page_text = page_info["text"]

            # 오버랩 처리 (400자로 변경)
            overlap_prefix = ""
            if prev_text and len(prev_text) > overlap_chars:
                overlap_prefix = f"[이전 페이지 연장 텍스트: ...{prev_text[-overlap_chars:]}]\n\n"

            # ⭐ Context Headering 보완 (피보험자 제외, 특약명/페이지번호/문서구조 주입)
            header = f"""[문서 구분: 보험약관]
[특약/약관명: {section_title}]
[페이지 위치: {page_num}페이지 (해당 특약 총 {total_section_pages}p 중)]
"""

            text_to_embed = f"{header}\n{overlap_prefix}{page_text}"

            # LangChain Document 객체 생성
            # task_name을 메타데이터에 넣어 Supabase의 공용 documents 테이블에서
            # 인물별로 격리 검색(filter={"task_name": ...})할 수 있게 합니다.
            doc = Document(
                page_content=text_to_embed,
                metadata={
                    "task_name": task_folder_name,
                    "section_title": section_title,
                    "page": page_num,
                    "source_pdf": source_pdf
                }
            )
            documents.append(doc)
            prev_text = page_text

    print(f"📦 총 {len(documents)}개 페이지 청크 준비 완료 (Overlap: {overlap_chars}자 적용).")
    print("🌐 OpenAI 'text-embedding-3-small' 모델로 임베딩 진행 중...")

    embeddings = get_embeddings()
    supabase_client = get_supabase_client()

    # ⭐ 재실행 시 기존 벡터가 중복/누적되지 않도록 이 인물(task_name)의 기존 행을 지우고 재적재 (idempotent rebuild)
    print(f"🧹 기존 '{task_folder_name}' 벡터 삭제 중 (Supabase documents 테이블)...")
    clear_task_documents(task_folder_name)

    # Supabase(pgvector) 저장
    SupabaseVectorStore.from_documents(
        documents=documents,
        embedding=embeddings,
        client=supabase_client,
        table_name=DOCUMENTS_TABLE,
        query_name=MATCH_FUNCTION,
        chunk_size=500,
    )

    print(f"\n🎉 [step_3 완료] Vector DB(Supabase pgvector) 구축 성공!")
    print(f"🗄️ 테이블: {DOCUMENTS_TABLE} (task_name='{task_folder_name}')")

if __name__ == "__main__":
    task_name = input("진행할 작업명을 입력하세요 (예: jang): ").strip()
    if task_name:
        run_step_3(task_name)
