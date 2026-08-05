# [Phase 1: FastAPI 뼈대] 웹 API 서버의 진입점. 지금은 헬스체크 + SSE mock 챗 엔드포인트만
# 있고, Phase 2부터 Agent 2(AI Graph)/Agent 4(DB) 라우터가 이 위에 계속 추가됩니다.
# 실행: uvicorn backend.app.main:app --reload --port 8000  (프로젝트 루트에서)
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import chat

app = FastAPI(
    title="Finance QA Backend",
    description="보험약관 RAG 챗봇 API (Phase 1: FastAPI 뼈대 + SSE mock 엔드포인트)",
    version="0.1.0",
)

# 프론트엔드(Next.js, 보통 localhost:3000)에서 오는 요청을 허용합니다.
# 배포 시에는 ALLOWED_ORIGINS 환경변수로 실제 도메인을 콤마로 넣어주세요.
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)


@app.get("/")
def root():
    return {"service": "finance-qa-backend", "status": "ok"}


@app.get("/health")
def health():
    """[점검 노드 1]에서 프론트엔드가 백엔드 살아있는지 확인할 때 쓰는 엔드포인트."""
    return {"status": "ok"}
