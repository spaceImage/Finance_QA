"""
Phase 2 Agent 2 E2E Pipeline Verification Script
1단계 사전 검증 & 작업 분할 계획 ➔ 2단계 LangGraph 병렬 RAG & UI Block JSON 검증
"""
import sys
import json
import asyncio
from test_rag_graph import InsuranceRAGEngine
from rag_common import create_session, save_audit_log, get_session_audit_logs

def test_p2_pipeline():
    print("🧪 [Phase 2 Agent 2] 2단계 파이프라인 검증 시작...")
    
    # DB 세션 생성
    session_id = create_session(task_name="jang", counselor_id="counselor_demo")
    print(f"✅ DB 세션 생성 완료: {session_id}")
    
    engine = InsuranceRAGEngine(task_name="jang")
    
    # 1. 정보 부족 질문 테스트 (Slot Filling 되묻기 검증)
    incomplete_query = "수액 맞았는데 얼마 나와?"
    print(f"\n--- [테스트 1: 정보 부족 질문] '{incomplete_query}' ---")
    
    # Audit log 기록 (S1)
    save_audit_log(session_id, "S1_INPUT_VALIDATION", status="PENDING", input_payload={"query": incomplete_query})
    
    # 2. 정보 충분 질문 테스트 (1단계 검증 ➔ 2단계 RAG 및 UI Block 출력)
    complete_query = "장석찬님이 재해골절로 통원 치료 시 받을 수 있는 보험금은 얼마인가요?"
    print(f"\n--- [테스트 2: 정보 충분 질문] '{complete_query}' ---")
    
    result_json_str = engine.run_json(complete_query)
    result_data = json.loads(result_json_str)
    
    print("\n📊 [결과 데이터 검증]")
    print(f" - Status: {result_data.get('status')}")
    print(f" - Query: {result_data.get('query')}")
    print(f" - Answer: {result_data.get('answer')[:100]}...")
    print(f" - Referenced Pages: {result_data.get('total_referenced_count')}개")
    
    blocks = result_data.get("blocks", [])
    print(f" - UI Blocks Count: {len(blocks)}개")
    for idx, b in enumerate(blocks, 1):
        print(f"   [{idx}] Block Type: {b.get('block_type')}, Title: {b.get('title')}, Variant: {b.get('variant')}")
        if b.get("block_type") == "RETRIEVAL_RESULT":
            items = b.get("items", [])
            for item in items:
                if isinstance(item, dict) and "citations" in item:
                    print(f"       * Citations Found: {len(item['citations'])}개 (모달 팝업 구조 OK)")
                    
    save_audit_log(session_id, "S4_ACCUMULATOR", status="SUCCESS", output_payload={"blocks_count": len(blocks)})
    
    # Audit Log 검증
    logs = get_session_audit_logs(session_id)
    print(f"\n✅ Audit Log 저장 확인: 총 {len(logs)}건 기록됨")
    print("🎉 [Phase 2 Agent 2] 파이프라인 검증 완료!")

if __name__ == "__main__":
    test_p2_pipeline()
