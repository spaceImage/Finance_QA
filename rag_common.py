"""
[공용 헬퍼] test_rag_graph.py와 step_3.py가 공통으로 쓰는 함수 모음.
- 인물(task_name)별 보험증권 마크다운(certificate.md) 로드
- 인물(task_name)별 실제 가입 특약 allowlist(enrolled_sections.json) 로드
- Supabase(pgvector) 벡터스토어 연결 및 인물별 데이터 삭제
"""
import os
import json
from typing import List, Optional
from dotenv import load_dotenv
from langchain_community.vectorstores import SupabaseVectorStore
from langchain_openai import OpenAIEmbeddings
from supabase.client import Client, create_client

load_dotenv()

DOCUMENTS_TABLE = "documents"
MATCH_FUNCTION = "match_documents"


def get_certificate_path(task_name: str) -> str:
    """인물별 보험증권 요약 마크다운 파일 경로. tasks/{task_name}/certificate.md"""
    return os.path.join("tasks", task_name, "certificate.md")


def load_policy_md(task_name: str) -> str:
    """개인 보험증권(certificate.md) 파일을 로드합니다. 파일이 없으면 빈 문자열을 반환합니다."""
    path = get_certificate_path(task_name)
    if not os.path.exists(path):
        print(f"⚠️ 경고: {path} 파일이 존재하지 않습니다.")
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def get_enrolled_sections_path(task_name: str) -> str:
    """인물별 실제 가입 특약 allowlist 경로. tasks/{task_name}/enrolled_sections.json"""
    return os.path.join("tasks", task_name, "enrolled_sections.json")


def get_enrolled_sections(task_name: str) -> Optional[List[str]]:
    """이 사람이 실제로 가입한 특약명(약관 section_title과 정확히 일치)의 allowlist를 로드합니다.
    원본 약관 PDF는 상품 전체(32개 특약 등)를 담고 있어서, 이 목록으로 걸러주지 않으면
    라우팅/검색이 '가입하지 않은 특약'까지 근거로 끌어와 답변에 섞어 쓰는 문제가 생깁니다.
    파일이 없으면 None을 반환합니다 (allowlist 없이 이전처럼 전체 특약을 대상으로 동작)."""
    path = get_enrolled_sections_path(task_name)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("enrolled_sections")


def get_supabase_client() -> Client:
    """SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수로 Supabase 클라이언트를 생성합니다."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError(
            "❌ .env 파일에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 설정해주세요."
        )
    return create_client(url, key)


def get_embeddings() -> OpenAIEmbeddings:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("❌ .env 파일의 OPENAI_API_KEY를 확인해주세요.")
    return OpenAIEmbeddings(model="text-embedding-3-small", openai_api_key=api_key)


def get_vectorstore(embeddings: Optional[OpenAIEmbeddings] = None) -> SupabaseVectorStore:
    """task_name과 무관한 공용 documents 테이블에 연결된 벡터스토어.
    검색 시 반드시 filter={"task_name": ...} 를 넘겨서 인물별로 격리하세요."""
    embeddings = embeddings or get_embeddings()
    client = get_supabase_client()
    return SupabaseVectorStore(
        client=client,
        embedding=embeddings,
        table_name=DOCUMENTS_TABLE,
        query_name=MATCH_FUNCTION,
    )


def clear_task_documents(task_name: str) -> None:
    """재구축(step_3) 전, 해당 인물의 기존 벡터를 모두 삭제해 중복 적재를 막습니다."""
    client = get_supabase_client()
    client.table(DOCUMENTS_TABLE).delete().eq("metadata->>task_name", task_name).execute()


def create_session(task_name: str, counselor_id: Optional[str] = None, metadata: Optional[dict] = None) -> Optional[str]:
    """새로운 상담 세션을 sessions 테이블에 생성하고 session_id (uuid string)를 반환합니다."""
    try:
        client = get_supabase_client()
        res = client.table("sessions").insert({
            "task_name": task_name,
            "counselor_id": counselor_id,
            "metadata": metadata or {},
        }).execute()
        if res.data and len(res.data) > 0:
            return res.data[0].get("id")
    except Exception as e:
        print(f"⚠️ session 생성 중 오류 발생: {e}")
    return None


def get_session_state(session_id: str) -> Optional[dict]:
    """session_id로 세션 정보 및 대화/슬롯 상태를 조회합니다."""
    try:
        client = get_supabase_client()
        res = client.table("sessions").select("*").eq("id", session_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
    except Exception as e:
        print(f"⚠️ session 조회 오류: {e}")
    return None


def update_session_state(session_id: str, metadata_updates: dict) -> bool:
    """세션 metadata에 새로운 대화 상태나 슬롯 데이터를 누적 저장합니다."""
    try:
        client = get_supabase_client()
        current = get_session_state(session_id)
        current_meta = current.get("metadata", {}) if current else {}
        updated_meta = {**current_meta, **metadata_updates}
        
        res = client.table("sessions").update({
            "metadata": updated_meta
        }).eq("id", session_id).execute()
        return bool(res.data)
    except Exception as e:
        print(f"⚠️ session 업데이트 오류: {e}")
        return False



def save_audit_log(
    session_id: str | None,
    step_name: str,
    status: str = "SUCCESS",
    input_payload: dict | None = None,
    output_payload: dict | None = None,
    execution_time_ms: int = 0
) -> dict | None:
    """RAG 오케스트레이터 각 단계(S1~S4)의 실행 이력을 audit_logs 테이블에 기록합니다."""
    if not session_id:
        return None
    try:
        client = get_supabase_client()
        res = client.table("audit_logs").insert({
            "session_id": session_id,
            "step_name": step_name,
            "status": status,
            "input_payload": input_payload or {},
            "output_payload": output_payload or {},
            "execution_time_ms": execution_time_ms
        }).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
    except Exception as e:
        print(f"⚠️ audit_log 저장 중 오류 발생 ({step_name}): {e}")
    return None


def get_session_audit_logs(session_id: str) -> list[dict]:
    """특정 세션의 전체 audit_logs 이력을 생성 시각 순으로 조회합니다."""
    try:
        client = get_supabase_client()
        res = client.table("audit_logs").select("*").eq("session_id", session_id).order("created_at").execute()
        return res.data or []
    except Exception as e:
        print(f"⚠️ audit_logs 조회 중 오류 발생: {e}")
        return []

