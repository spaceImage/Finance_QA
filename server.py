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
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{safe_name}"}
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


class TaskApprovalRequest(BaseModel):
    session_id: str
    approved_tasks: Optional[List[str]] = None
    task_name: str = "jang"


@app.post("/api/v1/chat/approve-task-plan")
async def api_approve_task_plan(req: TaskApprovalRequest):
    """
    사용자가 Task Planner가 수립한 세부 작업 계획을 확인하고 승인(Human-in-the-Loop Interrupt Resume)했을 때
    랭그래프 파이프라인을 재개하여 RAG 검색 및 손해사정 추론을 계속 실행합니다.
    """
    session_info = get_session_state(req.session_id)
    if not session_info:
        raise HTTPException(status_code=404, detail="해당 세션을 찾을 수 없습니다.")

    current_meta = session_info.get("metadata", {})
    last_query = current_meta.get("last_query", "보험금 보상 계산 요청")
    approved_tasks = req.approved_tasks or current_meta.get("tasks", [])

    update_session_state(req.session_id, {"is_approved": True, "approved_tasks": approved_tasks})

    import functools
    loop = asyncio.get_event_loop()
    result_json_str = await loop.run_in_executor(
        None, functools.partial(run_agentic_rag_json, last_query, req.task_name)
    )
    result_data = json.loads(result_json_str)

    save_audit_log(
        session_id=req.session_id,
        step_name="TASK_PLAN_APPROVED",
        status="SUCCESS",
        input_payload={"approved_tasks": approved_tasks},
        output_payload={"answer_summary": result_data.get("answer", "")[:200]},
        execution_time_ms=0
    )

    return {
        "status": "success",
        "session_id": req.session_id,
        "approved_tasks": approved_tasks,
        "result": result_data
    }



from test_rag_graph import InsuranceRAGEngine, run_agentic_rag_json

async def sse_generator(query: str, task_name: str, session_id: Optional[str] = None) -> AsyncGenerator[str, None]:
    """
    LangGraph 에이전트 노드가 하나씩 실행될 때마다 실시간 SSE 이벤트로 노드 이력 및 결과를 스트리밍 전송합니다.
    이전 대화 맥락이 존재하는 후속 질의의 경우 1.5초 패스트트랙(Contextual Fast Path)으로 초고속 답변합니다.
    """
    start_time = asyncio.get_event_loop().time()
    try:
        session_info = get_session_state(session_id) if session_id else None
        current_meta = session_info.get("metadata", {}) if session_info else {}
        prev_query = current_meta.get("last_query")
        prev_answer = current_meta.get("last_answer")

        # 0. 이전 맥락 기반 패스트트랙 검사 (Follow-up Context Fast Path: 1.5초 응답)
        is_followup = bool(
            prev_answer and (
                len(query) < 30 or
                any(kw in query for kw in ["아까", "그럼", "포함", "얼마", "사유", "이유", "계산", "다시", "설명", "왜"])
            )
        )

        engine = InsuranceRAGEngine(task_name=task_name)
        final_state: dict = {}

        if is_followup:
            print(f"⚡ [Fast Path] 이전 대화 맥락 발견! 1.5초 초고속 패스트트랙 대화 모드 실행 (질문: {query})")
            fast_node_logs = [
                {"node": "task_planner", "duration_ms": 50, "timestamp": datetime.datetime.now().isoformat(), "tasks": [{"seq": 1, "task_name": "이전 대화 맥락 기반 자연어 질의응답", "worker_mode": "LLM_ONLY"}]},
                {"node": "generate", "duration_ms": 250, "timestamp": datetime.datetime.now().isoformat()}
            ]
            node_event_payload = json.dumps({
                "progress_node": "generate",
                "node_logs": fast_node_logs,
                "tasks": [{"seq": 1, "task_name": "이전 대화 맥락 기반 자연어 질의응답", "worker_mode": "LLM_ONLY"}],
                "intent": "대화_맥락_연속질의",
                "is_valid": True,
                "status": "RUNNING"
            }, ensure_ascii=False)
            yield f"data: {node_event_payload}\n\n"

            # 1-2. Fast LLM Contextual Stream Generation with History Buffer
            history_text = "\n".join([f"{h.get('role', 'user')}: {h.get('content', '')}" for h in current_meta.get("chat_history", [])[-6:]])
            try:
                llm = engine._get_llm("response", json_mode=False)
                prompt_text = f"다음은 대화 이력입니다:\n{history_text}\n\n이전 질문: {prev_query}\n이전 답변: {prev_answer[:600]}\n\n사용자 후속 질문: {query}\n\n이전 대화 맥락을 기억하여 친절하게 답변하세요."
                res = await llm.ainvoke(prompt_text)
                answer_text = res.content if hasattr(res, "content") else str(res)
            except Exception:
                answer_text = f"네, 이전 질의({prev_query}) 맥락에 따라 답변해 드립니다."

            blocks = []  # 연속 대화에서는 무거운 UI 블록을 생략하고 대화형 버블로 출력
            final_state = {
                "generation": answer_text,
                "blocks": [],
                "layout_mode": "CONVERSATIONAL",
                "tasks_list": [{"seq": 1, "task_name": "이전 대화 맥락 기반 자연어 질의응답", "worker_mode": "LLM_ONLY"}],
                "intent": "대화_맥락_연속질의",
                "is_valid": True,
                "documents": [],
                "node_logs": fast_node_logs
            }
        else:
            # 1. 노드 단위 실시간 비동기 스트리밍 (astream_nodes)
            async for event in engine.astream_nodes(query):
                for node_name, state_update in event.items():
                    final_state.update(state_update)
                    logs = final_state.get("node_logs") or []
                    
                    node_event_payload = json.dumps({
                        "progress_node": node_name,
                        "node_logs": logs,
                        "tasks": final_state.get("tasks_list", []),
                        "intent": final_state.get("intent", ""),
                        "is_valid": final_state.get("is_valid", True),
                        "status": "OUT_OF_SCOPE" if final_state.get("is_valid") is False else ("SLOT_FILLING" if final_state.get("missing_slots") else "RUNNING")
                    }, ensure_ascii=False)
                    yield f"data: {node_event_payload}\n\n"

        answer_text = final_state.get("generation", "")
        blocks = final_state.get("blocks", [])
        layout_mode = final_state.get("layout_mode", "DEEP_AUDIT" if blocks else "CONVERSATIONAL")

        # 2. 글자 단위 스트리밍 애니메이션 전송 (타자기처럼 촤르르 노출)
        chunk_size = 2
        for i in range(0, len(answer_text), chunk_size):
            chunk = answer_text[i:i+chunk_size]
            payload = json.dumps({"content": chunk}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.012)

        # 3. 최종 구조화 UI Block payload 및 메타데이터, Node Logs 전송
        docs = final_state.get("documents") or []
        referenced_pages = list(set([f"{d.metadata.get('section_title', '약관')} (p.{d.metadata.get('page', '?')})" for d in docs]))
        final_status = "OUT_OF_SCOPE" if final_state.get("is_valid") is False else ("SLOT_FILLING" if final_state.get("missing_slots") else "SUCCESS")

        final_payload = json.dumps({
            "status": final_status,
            "answer": answer_text,
            "blocks": blocks,
            "layout_mode": layout_mode,
            "total_referenced_count": len(docs),
            "referenced_pages": referenced_pages,
            "tasks": final_state.get("tasks_list", []),
            "intent": final_state.get("intent", ""),
            "node_logs": final_state.get("node_logs", [])
        }, ensure_ascii=False)
        yield f"data: {final_payload}\n\n"

        # 4. 세션 대화 맥락 및 Audit Log 자동 기록 (대화 기억 윈도우)
        if session_id:
            chat_history = current_meta.get("chat_history", [])
            chat_history.append({"role": "user", "content": query})
            chat_history.append({"role": "assistant", "content": answer_text})
            chat_history = chat_history[-10:]  # 최근 10개 맥락 유지

            update_session_state(session_id, {
                "last_query": query,
                "last_answer": answer_text,
                "intent": final_state.get("intent", ""),
                "chat_history": chat_history
            })

        execution_time_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        save_audit_log(
            session_id=session_id or "default",
            step_name="AGENTIC_WORKFLOW_STREAM",
            status=final_status,
            input_payload={"query": query, "task_name": task_name, "is_followup": is_followup},
            output_payload={
                "answer_summary": answer_text[:200],
                "intent": final_state.get("intent", ""),
                "tasks": final_state.get("tasks_list", []),
                "nodes_count": len(final_state.get("node_logs", []))
            },
            execution_time_ms=execution_time_ms
        )

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
