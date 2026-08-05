# [Phase 1: Mock 라우터] "/api/v1/chat/stream" — SSE 스트리밍 배관이 실제로 동작하는지
# 증명하기 위한 가짜(mock) 응답 엔드포인트. 진짜 AI 엔진(test_rag_graph.py) 연결은
# Phase 2에서 Agent 2가 stream_answer()의 for 루프만 교체하는 방식으로 이어받습니다.
import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# 실제 답변이 나오기 전, 프론트엔드(Agent 3)가 스트리밍 UI를 먼저 만들어볼 수 있도록
# 흉내만 내는 고정 답변입니다. 실제 로직으로 교체될 부분이라 위치도 이 파일 안에 몰아뒀습니다.
MOCK_ANSWER = (
    "장석찬님, 문의하신 내용을 확인했습니다. "
    "재해치료비보장특약(갱신형, 무배당)에 따라 재해로 인한 골절 진단 시 "
    "특약보험가입금액의 3%인 300,000원이 지급됩니다. "
    "이 답변은 아직 실제 약관 검색 결과가 아닌 목업(mock) 데이터입니다."
)


class ChatRequest(BaseModel):
    question: str
    task_name: str = "jang"  # 나중에 여러 인물을 다루게 되면 세션에서 넘어올 값


def _sse_event(data: dict) -> str:
    """SSE 규격("data: <한 줄 JSON>\n\n")으로 한 이벤트를 인코딩합니다."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_answer(question: str):
    """실제 llm.stream() 대신 고정 문장을 어절 단위로 흘려보내는 목업 스트림.
    ⭐ Phase 2에서 여기를 test_rag_graph.py의 generate 노드가 만든 실제 스트림으로 교체합니다."""
    yield _sse_event({"type": "start", "question": question})

    for word in MOCK_ANSWER.split(" "):
        yield _sse_event({"type": "token", "content": word + " "})
        await asyncio.sleep(0.05)  # 실제 타이핑처럼 보이도록 약간의 지연

    yield _sse_event({"type": "done"})


@router.post("/stream")
async def chat_stream(payload: ChatRequest):
    """SSE(Server-Sent Events)로 답변을 토큰 단위로 스트리밍하는 기초 엔드포인트.
    지금은 목업 응답만 흘려보내고, 실제 질문 내용은 로그/이벤트에만 반영합니다."""
    return StreamingResponse(
        stream_answer(payload.question),
        media_type="text/event-stream",
        headers={
            # 프록시/브라우저가 응답을 버퍼링해서 스트리밍처럼 안 보이는 걸 방지
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
