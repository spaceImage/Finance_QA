# 📄 Finance QA: 보험약관 Agentic RAG 손해사정 상담 지원 시스템

PDF 보험약관을 목차(TOC) 기준으로 파싱해 JSON으로 구조화하고, **Supabase(pgvector) Vector DB**에 적재한 뒤, **LangGraph 기반 Agentic Orchestration Workflow**로 보험금 문의에 답변하는 시스템입니다. **FastAPI SSE 서버**가 답변을 실시간 스트리밍하고, **Next.js 프론트엔드**가 AIQ CS/CX 인바운드 상담사용 화면을 제공합니다.

> 📌 개발 배경(발견한 버그, 아키텍처 결정 이유)은 [modify.md](modify.md)에, Agentic Orchestration Workflow v2.0의 상세 명세(Node별 역할·모델 전략·API 응답 스키마)는 [AGENT.MD](AGENT.MD)에 정리되어 있습니다. 두 문서 모두 작성 시점이 서로 다른 개발 단계라 세부 흐름은 최신 코드(`test_rag_graph.py`) 기준으로 이 README를 우선 참고하세요.

---

## 📌 주요 기능

1. **작업(Task) 관리**: 고객/약관별 작업 폴더 자동 세팅 (`tasks/{task_name}/`)
2. **PDF 구조화 파싱**: `toc_config.csv` 및 PyMuPDF 기반으로 PDF 약관을 목차/섹션별 1차 JSON으로 분할 파싱 (2단/단일 컬럼 레이아웃 자동 판별)
3. **최종 JSON 병합 & Vector DB 구축**: 1차 파싱 JSON을 통합 JSON으로 병합 후, OpenAI `text-embedding-3-small` 임베딩으로 **Supabase(pgvector)** `documents` 테이블에 적재. 여러 인물의 데이터를 `task_name`으로 격리 저장하므로 서버리스 배포에도 그대로 씁니다.
4. **Agentic RAG 오케스트레이션 (v2.0)**: LangGraph 기반 11개 노드 워크플로우로 "질문 검증 → 작업 자율 기획(Task Planner) → 의도 라우팅/특약 매칭 → 슬롯(필수 정보) 체크 → 증권·약관 병렬 검색(Fan-out/Fan-in) → 문서 관련성 평가 → 연쇄 참조 조항 추적(Multi-hop) → 최종 답변/UI Block 생성"까지 처리합니다.
5. **FastAPI SSE 백엔드 서버**: 세션 생성/조회, 슬롯 보완, 노드 단위 실시간 진행 상황 + 글자 단위 스트리밍 답변을 Server-Sent Events로 제공합니다. 후속 질문은 1.5초 패스트트랙(Contextual Fast Path)으로 응답합니다.
6. **Next.js 상담사 화면**: 고객/가입 상품 정보 사이드바 + AIQ 채팅 탭 + 약관 원문(PDF) 뷰어 탭으로 구성된 SPA. 디버그 콘솔(`/debug`)에서 노드별 로그·모델·Raw JSON을 직접 확인할 수 있습니다.
7. **벤치마크/회귀 테스트**: 정답을 미리 아는 검증 질문 15개(단일 + Multi-hop 복합 5종)를 돌려서, 답변이 실제 근거 문서에 기반했는지(hallucination 없는지) LLM으로 이중 검증하는 스크립트를 포함합니다.

---

## 🧠 Agentic RAG 워크플로우 (LangGraph v2.0)

```text
START
  │
  ▼
query_validation ──(범위 밖 질문)──▶ out_of_scope_response ──▶ END
  │ (처리 가능)
  ▼
task_planner  (세부 작업 목록 + 수행 모드 RAG_ONLY/RAG_LLM/LLM_ONLY 자율 기획)
  │
  ▼
intent_router  (의도 분류 + 연관 특약 매칭, 가입 특약 allowlist로 후보 축소)
  │
  ▼
check_slots ──(필수 정보 부족, 예: 입원일수)──▶ ask_slots ──▶ END
  │ (충분)
  ▼
parallel_context_builder  (Task별 Vector 검색 + 증권 조회를 asyncio.gather로 병렬 Fan-out/Fan-in)
  │
  ▼
grade_documents  (검색 문서 관련성 LLM 배치 평가)
  ├─(문서 없음, 최초 시도)──▶ rewrite_query ──▶ parallel_context_builder (최대 1회 재검색 루프)
  ├─(문서 없음, 재시도 소진)──▶ fallback_generate ──▶ END
  └─(문서 있음)──▶ multi_hop_reasoning
                       │
                       ├─(별표/참조 조항 신규 발견, 루프 1회 이내)──▶ parallel_context_builder (Reflection Loop)
                       └─(그 외)──▶ generate ──▶ END
```

- **Task Planner**: 사용자 질문을 `RAG_ONLY`(단순 조회) / `RAG_LLM`(약관 대조) / `LLM_ONLY`(수치 계산)로 분해된 세부 작업 목록으로 자율 기획합니다.
- **Intent Router**: `tasks/{task_name}/enrolled_sections.json`(실제 가입 특약 allowlist)로 전체 특약 후보를 축소해, 가입하지 않은 특약이 근거로 섞여 들어가는 걸 막습니다.
- **Parallel Context Builder**: Task별 Vector 검색 워커 N개 + 증권 조회 워커를 `asyncio.gather()`로 동시 실행 후 중복 제거·병합합니다.
- **Multi-hop Reasoning**: 검색된 조항에서 `별표 N`, `제O조(...)` 같은 구체적 참조를 감지하면 보충 검색을 수행하고, 새 참조가 남아있으면 Context Builder로 되돌아가는 Reflection Loop를 최대 1회 수행합니다.
- **Response Builder(`generate`)**: 추론 결과 + 약관 원문 + 개인 증권을 결합해 답변과 `CONTEXT`/`RETRIEVAL_RESULT`/`CAUTION`/`DELIVER` 4종 UI Block JSON을 함께 생성합니다.
- 모든 노드는 `node_logs`(노드명·소요시간·타임스탬프)를 State에 누적하며, 이 로그가 그대로 SSE로 스트리밍되어 프론트엔드 디버그 콘솔에 표시됩니다.

### Model Orchestration (`config.py`)

노드별 모델은 하드코딩 대신 `config.py`의 `DEFAULT_MODEL_CONFIG`로 관리하며, 환경변수(`MODEL_PLANNER` 등)로 개별 override할 수 있습니다.

| Node | 기본 모델 | 환경변수 |
|---|---|---|
| planner / validator / router / retrieval / reasoning / context_validator | `gpt-4o-mini` | `MODEL_PLANNER`, `MODEL_VALIDATOR`, `MODEL_ROUTER`, `MODEL_RETRIEVAL`, `MODEL_REASONING`, `MODEL_CONTEXT_VALIDATOR` |
| response (최종 답변 생성) | `gpt-5-mini` | `MODEL_RESPONSE` |

> 분류/라우팅/검증처럼 반복 호출이 많은 노드는 저비용·고속 모델을, 최종 답변 생성만 고품질 모델을 쓰는 원칙입니다.

---

## 📁 프로젝트 구조

```text
Finance_QA/
├── main.py               # [준비 단계 진입점] 파이프라인 전체 실행 메인 CLI (step_1~3 실행)
├── step_1.py              # 1단계: PDF 파싱 & 목차별 1차 JSON 생성 (2단/단일 컬럼 레이아웃 자동 판별)
├── step_2.py              # 2단계: 1차 JSON 파일들을 최종 단일 JSON으로 병합
├── step_3.py              # 3단계: 최종 JSON 기반 Supabase(pgvector) Vector DB 적재
├── rag_common.py           # 공용 헬퍼: certificate.md/allowlist 로드, Supabase 벡터스토어, 세션/감사로그
├── rebuild_db.py           # 개발용 단축 스크립트: jang 한 명만 step_1~3 한 번에 재실행
├── config.py               # Node별 LLM 모델 오케스트레이션 설정 (Model Orchestration Strategy)
├── prompts.py              # Task Planner/Query Validation/Router/Reasoning/Response 프롬프트 모음
├── test_rag_graph.py       # [질문 단계 진입점] LangGraph 기반 Agentic RAG 엔진 (유일한 질의응답 파일)
├── server.py               # FastAPI SSE 서버: 세션/슬롯 보완/실시간 스트리밍 API
├── benchmark.py            # 검증 질문 15종 + LLM grounding 재검증으로 PASS/FAIL 리포트 생성
├── db/schema.sql            # Supabase에 한 번 실행: pgvector 확장, documents/sessions/audit_logs 테이블
├── requirements.txt         # 프로젝트(백엔드) 의존성 라이브러리 목록
├── AGENT.MD                 # Agentic Orchestration Workflow v2.0 상세 명세 (Node/모델 전략/API 스키마)
├── modify.md                 # 개발 히스토리 + 초기 아키텍처 다이어그램 (트러블슈팅 기록)
├── workflow_audit_logs.json  # save_audit_log()가 기록하는 파일 기반 감사 로그 (DB 미연동 시 fallback)
├── .gitignore                # Git 추적 제외 설정 파일 (.env 포함)
├── frontend/                 # Next.js 15(App Router) 기반 상담사 상담 지원 화면
│   ├── src/app/page.tsx        # 메인 화면(SPA): 사이드바 + AIQ 채팅 탭 + 약관 문서 탭
│   ├── src/app/debug/page.tsx  # 디버그 콘솔: 프리셋 질의 실행, 노드 로그/모델/Raw JSON 확인
│   ├── src/app/layout.tsx      # 루트 레이아웃 (폰트, 메타데이터)
│   ├── src/hooks/useSSE.ts     # SSE 스트림 구독 + 세션/슬롯보완/작업승인 API 훅
│   ├── src/components/PdfHighlightViewer.tsx  # react-pdf 기반 약관 PDF 뷰어(검색/페이지 이동)
│   └── design.md               # 현재 UI 디자인 시스템 기록 문서 (색상/타이포/컴포넌트 인벤토리)
└── tasks/                    # 작업(Task) 데이터 저장 디렉토리
    └── {task_name}/
        ├── inputs/                 # PDF 약관 원본(raw_policy.pdf) 및 목차 설정(toc_config.csv)
        ├── parsed_json_parts/      # 목차별 분할 파싱 1차 JSON 파일들
        ├── final_output/           # 병합 완료된 최종 통합 JSON 파일
        ├── certificate.md          # 그 사람 보험증권(가입금액·보장금액) 요약 markdown
        └── enrolled_sections.json  # 실제 가입 특약명 allowlist (라우팅 후보 축소용)
```

> 벡터 데이터는 로컬 폴더(`tasks/{name}/vector_db/`)가 아니라 **Supabase 클라우드 DB 하나**로 통합되어 있습니다.

---

## 🛠️ 설치 및 환경 설정

### 1. 백엔드 — 가상환경 생성 및 의존성 설치

```bash
# 가상환경 생성 및 활성화
python -m venv .venv
source .venv/Scripts/activate  # Windows (Git Bash)
# .venv\Scripts\activate       # Windows (PowerShell/cmd)
# source .venv/bin/activate    # macOS / Linux

# 필요한 패키지 설치
pip install -r requirements.txt
```

### 2. 환경변수 설정 (`.env`, 프로젝트 루트)

```env
# OpenAI (임베딩 + LLM)
OPENAI_API_KEY=your_openai_api_key_here

# Supabase (Project Settings > API)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_secret_key_here

# Postgres 직접 연결 문자열 (db/schema.sql 실행 시에만 필요)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres

# (선택) Node별 모델 override — 미설정 시 config.py 기본값 사용
# MODEL_PLANNER=gpt-4o-mini
# MODEL_RESPONSE=gpt-5-mini
```

이 파일은 git에 올라가지 않습니다(`.gitignore`).

### 3. Supabase 스키마 적용 (최초 1회)

Supabase 대시보드 SQL Editor에서 [db/schema.sql](db/schema.sql) 내용을 그대로 실행합니다. `pgvector` 확장, `documents`(약관 벡터), `sessions`(상담 세션), `audit_logs`(오케스트레이션 단계별 감사 로그) 테이블과 `match_documents` 검색 함수가 만들어집니다.

### 4. 프론트엔드 — 의존성 설치

```bash
cd frontend
npm install
```

프론트엔드가 백엔드와 다른 주소로 배포될 경우, `frontend/.env.local`에 API 주소를 지정합니다 (기본값 `http://localhost:8000`):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 🚀 사용 방법

### 1. 데이터 준비 단계 (`main.py`)

```bash
python main.py
```

인터랙티브 메뉴로 진행합니다:

```text
==========================================
 📄 보험약관 구조화 & Vector DB 구축 파이프라인
==========================================
 1. [1단계] 새 작업 폴더 생성
 2. [2단계] PDF 파싱 & 목차별 1차 JSON 생성 (step_1.py)
 3. [3단계] 1차 JSON 검토 후 최종 단일 JSON 병합 (step_2.py)
 4. [4단계] 최종 JSON 기반 Vector DB 생성 (step_3.py)
 0. 종료
==========================================
```

1. **[1단계] 새 작업 폴더 생성**: 예시로 `jang` 등의 작업명을 입력합니다.
2. **입력 파일 준비**: `tasks/{task_name}/inputs/`에 `raw_policy.pdf`(원본 약관 PDF), `toc_config.csv`(목차 설정) 투입
3. **[2단계] PDF 파싱**: PDF와 TOC 설정을 매핑해 섹션별 JSON 조각 생성 (2단 레이아웃 자동 정렬)
4. **[3단계] 단일 JSON 병합**: 분할 파싱 JSON들을 하나의 최종 JSON으로 결합
5. **[4단계] Vector DB 구축**: 최종 JSON을 임베딩해 Supabase(pgvector)에 저장. 재실행해도 기존 벡터를 지우고 새로 넣으므로 중복 적재되지 않습니다.
6. **(선택) 개인화 파일 추가**: `tasks/{task_name}/certificate.md`(가입금액·보장금액 요약), `enrolled_sections.json`(실제 가입 특약 목록)을 채워두면 라우팅 정확도와 계산 근거가 좋아집니다.

`jang` 한 명만 빠르게 전체 재실행하려면 `python rebuild_db.py`로도 가능합니다.

### 2. 백엔드 SSE 서버 실행

```bash
python server.py
# 또는
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

주요 엔드포인트:

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/rag/stream` | 질문(`query`)에 대한 답변을 SSE로 실시간 스트리밍 (`task_name`, `session_id` 옵션) |
| POST | `/api/v1/session/create` | 상담 세션 생성 |
| GET | `/api/v1/session/{session_id}` | 세션 상태/대화 이력 조회 |
| POST | `/api/v1/chat/slot-fill` | 부족한 필수 정보(슬롯) 보완 후 파이프라인 재개 |
| POST | `/api/v1/chat/approve-task-plan` | Task Planner 계획 승인(Human-in-the-Loop) 후 재개 |
| GET | `/api/v1/policy/{task_name}` | 보험증권(`certificate.md`) 원문 조회 |
| GET | `/api/v1/policy-pdf/{task_name}` | 보험약관 원본 PDF 조회 |

### 3. 프론트엔드 실행

```bash
cd frontend
npm run dev
```

`http://localhost:3000`에서 상담사 화면을, `http://localhost:3000/debug`에서 프리셋 질의·노드 로그·Raw JSON을 확인할 수 있는 디버그 콘솔을 볼 수 있습니다. UI 구조/디자인 토큰은 [frontend/design.md](frontend/design.md)에 정리되어 있습니다.

---

## 🔍 테스트 방법

### 1. 터미널에서 직접 질문해보기

Vector DB 구축이 끝났다면 `test_rag_graph.py`를 바로 실행해서 질문할 수 있습니다. 답변이 만들어지는 동안 각 노드(라우팅 → 검색 → 문서 평가 → 추론 → 답변 생성)의 진행 로그가 콘솔에 함께 출력됩니다.

```bash
# 기본 데모 질문으로 1회 실행
python test_rag_graph.py

# 질문을 직접 지정해서 1회 실행
python test_rag_graph.py "장염으로 내과에서 수액을 맞았는데 얼마나 보상받을 수 있어?"
```

### 2. 코드에서 직접 호출하기

```python
from test_rag_graph import run_agentic_rag, run_agentic_rag_json

# 그래프 최종 State(dict)를 그대로 반환
run_agentic_rag("갑상선암 진단 시 보장 금액은?")

# API/화면 연동용 — JSON 문자열 반환 (답변/UI Block/참조 페이지/노드 로그 포함)
result_json = run_agentic_rag_json("갑상선암 진단 시 보장 금액은?")
```

### 3. 회귀 테스트(벤치마크) 돌리기

단일 질의 10종 + Multi-hop 복합 질의 5종, 총 15개 검증 질문을 실행하고, 답변이 실제 근거 문서·증권과 부합하는지(hallucination 없는지) 별도 LLM으로 재검증한 뒤 PASS/FAIL 리포트를 만듭니다.

```bash
python benchmark.py
```

결과는 `benchmark_results.json`에 저장되고, 콘솔에 질문별 PASS/FAIL·판정 이유·소요시간이 출력됩니다. `test_rag_graph.py`나 프롬프트를 수정한 뒤 정확도가 떨어지지 않았는지 확인하는 용도로 재사용하시면 됩니다.

### 4. 프론트엔드 디버그 콘솔

`npm run dev` 후 `http://localhost:3000/debug`에서 프리셋 질의(정상 RAG 3종 + Out-of-Scope 차단 1종)를 실행하며 노드별 소요시간, 사용 모델, Raw JSON 응답을 시각적으로 확인할 수 있습니다.

---

## 📜 라이선스

This project is open-source.
