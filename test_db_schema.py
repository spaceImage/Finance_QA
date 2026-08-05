"""
P1 Agent 4 (DB/QA) 전용 검증 스크립트
Supabase sessions 및 audit_logs 테이블 연동 테스트
"""
import sys
from rag_common import create_session, save_audit_log, get_session_audit_logs

def main():
    print("🧪 [P1 A4] Sessions & Audit Logs DB 연동 테스트 시작...")
    
    # 1. 세션 생성 테스트
    task_name = "jang"
    print(f"1. 세션 생성 중... (task_name: {task_name})")
    session_id = create_session(task_name=task_name, counselor_id="counselor_01", metadata={"test": True})
    
    if not session_id:
        print("❌ 세션 생성 실패! .env 설정(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 및 db/schema.sql 실행 여부를 확인하세요.")
        sys.exit(1)
        
    print(f"✅ 세션 생성 성공! Session ID: {session_id}")
    
    # 2. Audit Log 저장 테스트
    print("2. Audit Log (S1~S4 단계) 기록 저장 테스트 중...")
    log1 = save_audit_log(
        session_id=session_id,
        step_name="S1_INPUT_VALIDATION",
        status="SUCCESS",
        input_payload={"query": "갑상선암 진단 시 보장 금액은?"},
        output_payload={"is_valid": True},
        execution_time_ms=120
    )
    print(f"  - S1 Log ID: {log1.get('id') if log1 else '실패'}")
    
    log2 = save_audit_log(
        session_id=session_id,
        step_name="S3_PARALLEL_RAG",
        status="SUCCESS",
        input_payload={"selected_sections": ["리빙케어보장특약"]},
        output_payload={"documents_count": 3},
        execution_time_ms=450
    )
    print(f"  - S3 Log ID: {log2.get('id') if log2 else '실패'}")
    
    # 3. Audit Log 조회 테스트
    print("3. Audit Log 조회 중...")
    logs = get_session_audit_logs(session_id)
    print(f"✅ 조회된 로그 개수: {len(logs)}개")
    for l in logs:
        print(f"   [Step: {l['step_name']}] Status: {l['status']} (소요시간: {l['execution_time_ms']}ms)")
        
    print("\n🎉 [P1 A4] DB & 스키마 연동 검증이 완료되었습니다!")

if __name__ == "__main__":
    main()
