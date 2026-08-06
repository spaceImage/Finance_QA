import os
import json
import asyncio
from typing import AsyncGenerator, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse

# main 브랜치 최신 Agentic RAG 파이프라인 연동 및 세션 헬퍼
from test_rag_graph import run_agentic_rag_json
from rag_common import create_session, get_session_state, update_session_state, load_policy_md

app = FastAPI(title="Finance QA Agentic RAG SSE Server")

# Next.js 프론트엔드 CORS 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CreateSessionRequest(BaseModel):
    task_name: str = "jang"
    counselor_id: Optional[str] = None
    metadata: Optional[dict] = None

@app.get("/")
def read_root():
    return {"message": "Finance QA Agentic RAG SSE Server is running!"}

@app.post("/api/v1/session/create")
def api_create_session(req: CreateSessionRequest):
    """신규 대화 세션을 생성하고 session_id를 반환합니다."""
    session_id = create_session(
        task_name=req.task_name,
        counselor_id=req.counselor_id,
        metadata=req.metadata or {}
    )
    if not session_id:
        raise HTTPException(status_code=500, detail="세션 생성에 실패했습니다.")
    return {
        "status": "success",
        "session_id": session_id,
        "task_name": req.task_name
    }

class SlotFillRequest(BaseModel):
    session_id: str
    slot_key: str
    slot_value: str
    task_name: Optional[str] = "jang"

@app.get("/api/v1/policy/{task_name}")
def api_get_policy(task_name: str = "jang"):
    """고객의 보험증권(certificate.md) 원문 텍스트를 반환합니다."""
    try:
        policy_md = load_policy_md(task_name)
        return {
            "status": "success",
            "task_name": task_name,
            "policy_md": policy_md
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"보험증권 로드 실패: {e}")

@app.get("/api/v1/policy-pdf/{task_name}")
def api_get_policy_pdf(task_name: str = "jang"):
    """고객의 보험약관 PDF 파일을 반환합니다."""
    import glob
    pattern = f"pdf_policy/{task_name[0].upper() if task_name else ''}*보험약관*.pdf"
    # task_name 이니셜로 파일 검색 (jang -> 장)
    name_map = {"jang": "장석찬"}
    person_name = name_map.get(task_name, task_name)
    matches = glob.glob(f"pdf_policy/{person_name}*.pdf")
    if not matches:
        raise HTTPException(status_code=404, detail=f"약관 PDF를 찾을 수 없습니다: {task_name}")
    from urllib.parse import quote
    safe_name = quote(f"{person_name}_보험약관.pdf")
    return FileResponse(
        matches[0],
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="policy.pdf"'}
    )

@app.get("/api/v1/session/{session_id}")
def api_get_session(session_id: str):
    """세션 상태 및 대화 히스토리를 조회합니다."""
    session_info = get_session_state(session_id)
    if not session_info:
        raise HTTPException(status_code=404, detail="해당 세션을 찾을 수 없습니다.")
    return {
        "status": "success",
        "session": session_info
    }

@app.post("/api/v1/chat/slot-fill")
async def api_slot_fill(req: SlotFillRequest):
    """
    부족한 필수 조건(슬롯) 데이터를 보완 전송받아 기존 세션에 누적 업데이트하고
    RAG 파이프라인을 재개하여 최종 보상 정밀 결과를 반환합니다.
    """
    # 1. 기존 세션 정보 조회
    session_info = get_session_state(req.session_id)
    if not session_info:
        raise HTTPException(status_code=404, detail="해당 세션을 찾을 수 없습니다.")

    # 2. 슬롯 데이터 누적 업데이트
    current_meta = session_info.get("metadata", {})
    existing_slots = current_meta.get("slot_values", {})
    existing_slots[req.slot_key] = req.slot_value
    
    update_success = update_session_state(req.session_id, {"slot_values": existing_slots})
    if not update_success:
        raise HTTPException(status_code=500, detail="슬롯 상태 업데이트에 실패했습니다.")

    # 3. 보완된 질문 컨텍스트 생성 후 RAG 구동
    last_query = current_meta.get("last_query", "보험금 보상 계산 요청")
    augmented_query = f"{last_query} (보완 정보: {req.slot_key}={req.slot_value})"
    
    import functools
    loop = asyncio.get_event_loop()
    result_json_str = await loop.run_in_executor(
        None, functools.partial(run_agentic_rag_json, augmented_query, req.task_name, slot_values=existing_slots)
    )
    result_data = json.loads(result_json_str)

    return {
        "status": "success",
        "session_id": req.session_id,
        "updated_slot": {req.slot_key: req.slot_value},
        "all_slots": existing_slots,
        "result": result_data
    }

async def sse_generator(query: str, task_name: str, confirm: bool = True) -> AsyncGenerator[str, None]:
    """
    MVP 원스톱 RAG 파이프라인:
    중간 멈춤 없이 1단계 특약 라우팅 ➔ 2단계 약관 DB 정밀 검색 및 보상 산출 ➔ UI 블록 & 각주 전송
    """
    try:
        # Step 1: 라우팅 & 입력 팩트 확인
        yield f"data: {json.dumps({'step': 1, 'label': '🔮 1단계: 상담 정보 및 특약 라우팅 확인 중...', 'progress': 25}, ensure_ascii=False)}\n\n"
        await asyncio.sleep(0.05)

        # Step 2: 약관 DB 정밀 검색
        yield f"data: {json.dumps({'step': 2, 'label': '📚 2단계: 약관 DB 정밀 검색 및 보상 분석 중...', 'progress': 65}, ensure_ascii=False)}\n\n"
        await asyncio.sleep(0.05)

        loop = asyncio.get_event_loop()
        result_json_str = await loop.run_in_executor(
            None, run_agentic_rag_json, query, task_name
        )

        result_data = json.loads(result_json_str)
        answer_text = result_data.get("answer", "")
        blocks = result_data.get("blocks", [])
        status = result_data.get("status", "SUCCESS")

        yield f"data: {json.dumps({'step': 3, 'label': '✍️ 3단계: 보상 산출 결과 및 UI 블록 카드 생성 완료', 'progress': 100}, ensure_ascii=False)}\n\n"
        await asyncio.sleep(0.05)

        # 2. 텍스트 스트리밍 전송 (chunk 단위)
        chunk_size = 5
        for i in range(0, len(answer_text), chunk_size):
            chunk = answer_text[i:i+chunk_size]
            payload = json.dumps({"content": chunk}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.01)

        # 3. 최종 구조화 UI Block payload 및 메타데이터 전송
        final_payload = json.dumps({
            "status": status,
            "task_classification": result_data.get("task_classification", []),
            "task_plan": result_data.get("task_plan", []),
            "answer": answer_text,
            "consultation_summary": result_data.get("consultation_summary", ""),
            "blocks": blocks,
            "total_referenced_count": result_data.get("total_referenced_count", 0),
            "referenced_pages": result_data.get("referenced_pages", [])
        }, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

        # SSE 완료 신호
        yield "data: [DONE]\n\n"

    except Exception as e:
        error_msg = f"서버 오류 발생: {str(e)}"
        yield f"data: {json.dumps({'error': error_msg}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

@app.get("/api/rag/stream")
@app.get("/api/stream_agentic_rag")
@app.get("/api/v1/chat/stream")
async def rag_stream(
    query: str = Query(..., description="사용자 질문"),
    task_name: str = Query("jang", description="작업명 (기본: jang)"),
    confirm: bool = Query(False, description="상담사 조사 승인 여부"),
    session_id: Optional[str] = Query(None, description="대화 세션 ID (선택)")
):
    return StreamingResponse(
        sse_generator(query, task_name, confirm=confirm),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
