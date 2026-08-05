import os
import json
import asyncio
from typing import AsyncGenerator, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# main 브랜치 최신 Agentic RAG 파이프라인 연동 및 세션 헬퍼
from test_rag_graph import run_agentic_rag_json
from rag_common import create_session, get_session_state, update_session_state

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



async def sse_generator(query: str, task_name: str) -> AsyncGenerator[str, None]:
    """
    RAG 파이프라인 결과를 SSE(Server-Sent Events) 프로토콜 데이터로 스트리밍 전송합니다.
    """
    try:
        # 비동기 스레드 풀에서 RAG 파이프라인 구동
        loop = asyncio.get_event_loop()
        result_json_str = await loop.run_in_executor(
            None, run_agentic_rag_json, query
        )
        
        result_data = json.loads(result_json_str)
        answer_text = result_data.get("answer", "")

        # 1. 텍스트 스트리밍 지원 (기존 useSSE 호환)
        chunk_size = 5
        for i in range(0, len(answer_text), chunk_size):
            chunk = answer_text[i:i+chunk_size]
            payload = json.dumps({"content": chunk}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.01)

        # 2. 최종 구조화 UI Block payload 및 메타데이터 전송
        final_payload = json.dumps({
            "status": result_data.get("status", "SUCCESS"),
            "answer": answer_text,
            "blocks": result_data.get("blocks", []),
            "total_referenced_count": result_data.get("total_referenced_count", 0),
            "referenced_pages": result_data.get("referenced_pages", [])
        }, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

        # SSE 완료 신호
        yield "data: [DONE]\n\n"


    except Exception as e:
        error_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"data: {error_payload}\n\n"

@app.get("/api/rag/stream")
async def rag_stream(
    query: str = Query(..., description="사용자 질문"),
    task_name: str = Query("jang", description="작업명 (기본: jang)"),
    session_id: Optional[str] = Query(None, description="대화 세션 ID (선택)")
):
    return StreamingResponse(
        sse_generator(query, task_name),
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
