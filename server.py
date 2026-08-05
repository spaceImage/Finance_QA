import os
import json
import asyncio
from typing import AsyncGenerator
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# main 브랜치 최신 Agentic RAG 파이프라인 연동
from test_rag_graph import run_agentic_rag_json

app = FastAPI(title="Finance QA Agentic RAG SSE Server")

# Next.js 프론트엔드 CORS 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Finance QA Agentic RAG SSE Server is running!"}

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

        # 글자 단위 스트리밍 전송 (chunk 단위)
        chunk_size = 5
        for i in range(0, len(answer_text), chunk_size):
            chunk = answer_text[i:i+chunk_size]
            payload = json.dumps({"content": chunk}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
            await asyncio.sleep(0.02)  # 실시간 스트리밍 타자기 효과

        # SSE 완료 신호
        yield "data: [DONE]\n\n"

    except Exception as e:
        error_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"data: {error_payload}\n\n"

@app.get("/api/rag/stream")
async def rag_stream(
    query: str = Query(..., description="사용자 질문"),
    task_name: str = Query("jang", description="작업명 (기본: jang)")
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
