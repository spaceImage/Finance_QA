# Finance QA Backend (Phase 1)

기존 CLI(`test_rag_graph.py`)를 웹 API로 옮기는 첫 단계. 지금은 실제 AI 엔진 없이,
SSE 스트리밍 배관(plumbing) 자체가 프론트엔드까지 잘 연결되는지만 검증하는 **목업(mock) 서버**입니다.

## 실행 방법

프로젝트 루트(`Finance_QA/`)에서:

```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 서버 살아있는지 확인 (헬스체크) |
| POST | `/api/v1/chat/stream` | SSE로 답변을 토큰 단위로 스트리밍 (지금은 mock 답변) |

## `/api/v1/chat/stream` 사용 예시

요청 본문:
```json
{ "question": "재해로 뼈가 부러지면 얼마 받아?" }
```

`curl`로 스트리밍 확인 (`-N`을 꼭 붙여야 버퍼링 없이 실시간으로 보입니다):
```bash
curl -N -X POST http://localhost:8000/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "재해로 뼈가 부러지면 얼마 받아?"}'
```

응답은 아래처럼 한 줄씩(SSE 이벤트) 흘러나옵니다:
```
data: {"type": "start", "question": "재해로 뼈가 부러지면 얼마 받아?"}

data: {"type": "token", "content": "장석찬님, "}

data: {"type": "token", "content": "문의하신 "}
...
data: {"type": "done"}
```

## 다음 단계 (Phase 2, Agent 2 담당)
`app/routers/chat.py`의 `stream_answer()` 함수 안, `MOCK_ANSWER`를 어절 단위로 흘려보내는
`for` 루프 부분을 `test_rag_graph.py`의 LangGraph 실행 결과(실제 `llm.stream()` 토큰)로
교체하면 됩니다. 이벤트 형식(`{"type": "token", "content": ...}` / `{"type": "done"}`)은
그대로 유지해서 프론트엔드가 코드를 안 고쳐도 되게 하는 게 목표입니다.
