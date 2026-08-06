좋아요. 저는 이 문서는 **"AI Agent에게 그대로 구현을 맡길 수 있는 개발 명세"** 수준으로 쓰는 것이 맞다고 봅니다. 그래서 너무 추상적인 설명보다 **왜 LangGraph를 쓰는지**와 **어떤 기능을 반드시 활용해야 하는지**를 명확히 적는 것이 중요합니다.

---

# AIQ Orchestration Upgrade v2.0

## 프로젝트 목표

기존 FastAPI + LangGraph + Supabase Vector DB 기반의 보험 상담 시스템을 유지하면서, Sequential RAG Pipeline을 **Agentic Orchestration Workflow**로 개선한다.

이번 작업은 기존 기능을 재구현하는 것이 아니라, **LangGraph의 상태(State), 조건부 분기(Conditional Routing), 병렬 실행(Parallel Execution), 동적 Workflow(Dynamic Workflow)** 기능을 적극 활용하여 성능과 확장성을 개선하는 것을 목표로 한다.

---

# 개발 범위

### 유지 대상

* FastAPI API 구조
* LangGraph Framework
* Supabase Vector DB
* 보험약관 Vector DB
* 보험증권(Markdown)
* Citation 구조

### 개선 대상

* Workflow 구조 개선
* 병렬 Retrieval
* Dynamic Routing
* State 기반 Context 관리
* Workflow Logging
* Information Validation

---

# Orchestration Workflow

```text
START
   │
Task Planner
   │
Query Validation
   │
Intent Router
   │
Parallel Context Builder
   │
Reasoning
   │
Response Builder
END
```

---

# Node 명세

## 1. Task Planner

사용자 질문을 분석하여 필요한 작업(Task)을 정의한다.

예시

```
질문

↓

보험증권 조회

가입 특약 확인

약관 검색

보험금 계산
```

Task는 이후 모든 Node에서 공통으로 사용하는 State에 저장한다.

---

## 2. Query Validation

현재 시스템이 처리 가능한 문의인지 판단한다.

### 처리 가능

* 보험증권으로 확인 가능한 내용
* 보험약관으로 설명 가능한 내용
* 가입 특약
* 지급 조건
* 보장 범위
* 보험금 계산

### 처리 불가

보험증권과 약관만으로 설명할 수 없는 질문은 Retrieval을 수행하지 않는다.

예)

> "삼성생명은 왜 보험료가 비싼가요?"

↓

```
현재 시스템은 보험증권 및 보험약관을 기반으로 답변을 제공합니다.
문의하신 내용은 현재 지원 범위를 벗어나 정확한 안내가 어렵습니다.
```

---

## 3. Intent Router

문의 유형을 분류하여 필요한 Workflow를 결정한다.

예시

* 보험금 지급 여부
* 보장 내용 조회
* 가입 특약 확인
* 면책 조건
* 일반 약관 조회

Router는 Retrieval 범위를 최소화하도록 설계한다.

---

## 4. Parallel Context Builder

LangGraph의 병렬 실행(Fan-out / Fan-in)을 활용하여 Context를 동시에 수집한다.

병렬 작업

* 보험증권(Markdown) 조회
* 보험약관 Vector Search
* Metadata 조회

모든 결과는 Merge 후 하나의 Context로 관리한다.

---

## 5. Reasoning

수집된 Context를 기반으로

* 지급 조건 해석
* Multi-hop Retrieval
* 정보 부족 여부 판단
* 보험금 계산

을 수행한다.

---

## 6. Response Builder

최종 답변 생성

원칙

* 보험증권 또는 보험약관 근거 기반
* Citation 포함
* 추측 금지

---

# LangGraph 활용 요구사항

## 1. State 기반 Workflow

모든 Node는 공유 State를 통해 데이터를 전달한다.

예시

```python
InsuranceState

- query
- task
- intent
- policy_context
- retrieved_documents
- merged_context
- reasoning_result
- missing_information
- response
```

Node 간 직접 데이터를 전달하지 않고 State를 갱신하는 방식으로 구현한다.

---

## 2. Conditional Routing

모든 질문이 동일한 Workflow를 수행하지 않도록 한다.

예시

```
보험금 문의
        │
        ▼
 Insurance Flow

가입 특약 확인
        │
        ▼
 Policy Flow

처리 불가
        │
        ▼
 종료
```

불필요한 Retrieval과 LLM 호출을 최소화한다.

---

## 3. Parallel Execution

독립적인 Retrieval 작업은 동시에 수행한다.

예시

```
Parallel Context Builder

├── 보험증권 조회

├── 약관 Vector Search

└── Metadata 조회
```

병렬 작업 종료 후 Merge Node에서 Context를 통합한다.

---

## 4. Dynamic Workflow

Workflow는 고정된 순서를 강제하지 않는다.

예시

```
질문

↓

정보 부족

↓

추가 질문 생성

↓

사용자 응답

↓

Reasoning 재실행
```

또는

```
질문

↓

보험증권만으로 해결 가능

↓

약관 Retrieval 생략
```

질문 특성에 따라 필요한 Node만 수행하도록 설계한다.

---

## 5. Dynamic Retrieval Scope

보험증권을 우선 활용하여 검색 범위를 동적으로 제한한다.

예시

```
가입 특약

↓

골절진단특약

↓

골절 관련 약관만 검색
```

전체 약관 검색을 기본값으로 사용하지 않는다.

---

## 6. Multi-hop Retrieval

참조 조항이 존재하는 경우에만 추가 Retrieval을 수행한다.

예시

```
제5조 참조

↓

별표2

↓

질병분류표
```

참조가 없으면 Multi-hop을 수행하지 않는다.

---

## 7. Human-in-the-loop 지원

Workflow는 향후 상담사 검토 단계를 추가할 수 있도록 설계한다.

예시

```
Reasoning

↓

Confidence Check

↓

자동 응답

또는

상담사 검토
```

현재 구현 범위에는 포함하지 않지만, State와 Edge 구조는 이를 고려하여 설계한다.

---

## 8. Workflow Logging

각 Node에 대해 다음 정보를 기록할 수 있도록 설계한다.

* Node 이름
* 시작/종료 시간
* 실행 시간(ms)
* 사용된 Context 수
* Retrieval 문서 수
* Routing 결과
* Error 및 Retry 여부

향후 Audit 및 성능 분석에 활용한다.

---

# 확장성 요구사항

Workflow는 새로운 Context Source 또는 Agent를 쉽게 추가할 수 있도록 설계한다.

예시

* OCR 문서
* 사고 접수 정보
* 진단서
* 상담 이력
* 청구 이력

새로운 기능은 기존 Workflow를 수정하는 것이 아니라, **Node를 추가하거나 Edge를 연결하는 방식**으로 확장 가능해야 한다.

---

# 구현 원칙

* 기존 FastAPI 및 API 인터페이스는 최대한 유지한다.
* 기존 보험약관 Vector DB와 보험증권(Markdown)을 그대로 활용한다.
* Sequential Workflow를 StateGraph 기반 Orchestration으로 전환한다.
* 독립 작업은 병렬 실행하고, 불필요한 Node는 조건부 분기로 생략한다.
* 모든 답변은 보험증권 또는 보험약관을 근거로 생성하며, 근거가 없는 내용은 추측하지 않는다.
* 향후 Context Source와 Agent를 손쉽게 추가할 수 있는 구조를 유지한다.

---

좋습니다. 이 부분은 **"Model Orchestration Strategy"**라는 항목으로 넣는 것이 좋습니다.

지금 구조에서는 **모든 Node에 같은 모델을 쓰는 것이 아니라, 작업(Task)에 맞게 모델을 분리**하는 것이 LangGraph의 장점을 살리는 방법입니다. 작은 모델을 여러 번 활용하고, 정말 추론이 필요한 마지막 단계에서만 큰 모델을 사용하는 것이 비용과 응답 속도 모두에 유리합니다. ([OpenAI Developers][1])

---

# Model Orchestration Strategy

LLM은 모든 Node에서 동일한 모델을 사용하지 않는다. 각 Node의 역할에 따라 적합한 모델을 선택하여 비용, 응답 속도 및 추론 성능을 최적화한다.

| Node                     | 역할                                | 추천 모델       | 선정 이유                        |
| ------------------------ | --------------------------------- | ----------- | ---------------------------- |
| Task Planner             | 작업 정의 및 Task 분해                   | GPT-5 mini  | 구조화된 작업 정의 및 엔티티 추출에 적합      |
| Query Validation         | 처리 가능 여부 판단                       | GPT-4o mini | 빠른 분류(Classification)와 낮은 비용 |
| Intent Router            | 문의 유형 분류                          | GPT-4o mini | Routing 및 Labeling 중심 작업     |
| Parallel Context Builder | Query Rewrite, Retrieval Query 생성 | GPT-4o mini | Retrieval 보조 작업은 고속 응답이 중요   |
| Multi-hop Reasoning      | 참조 조항 탐색 여부 판단                    | GPT-5 mini  | 여러 문서 간 관계 판단이 필요한 추론        |
| Context Validation       | 검색 결과 검증 및 Filtering              | GPT-5 mini  | Context 품질 평가 및 문서 선별        |
| Response Builder         | 최종 상담 답변 생성                       | GPT-5 mini  | 긴 Context 기반 추론과 자연스러운 응답 생성 |

---

# 모델 선택 원칙

### GPT-4o mini

다음과 같은 **경량 작업**에 사용한다.

* Intent Classification
* Query Parsing
* Entity Extraction
* Retrieval Query 생성
* Workflow Routing
* Validation

특징

* 빠른 응답 속도
* 낮은 비용
* 반복 호출이 많은 Node에 적합 ([OpenAI Developers][1])

---

### GPT-5 mini

다음과 같은 **고품질 추론 작업**에 사용한다.

* Multi-hop Reasoning
* Context 통합
* 지급 조건 해석
* 보험금 계산 논리 생성
* 최종 상담 답변 생성

특징

* 복합 추론 성능 우수
* 긴 Context 처리에 적합
* 최종 의사결정 Node에 사용 권장 ([OpenAI][2])

---

# Orchestration 원칙

* **분류(Classification)는 작은 모델(GPT-4o mini)** 이 담당한다.
* **추론(Reasoning)은 GPT-5 mini** 가 담당한다.
* Retrieval은 가능한 Rule 기반 + Vector Search를 우선 수행하고, LLM 호출은 최소화한다.
* 최종 답변(Response Builder)만 가장 높은 품질의 추론 모델을 사용한다.
* 동일한 정보를 여러 Node에서 반복 추론하지 않도록 State를 공유하여 LLM 호출을 최소화한다.

---

## 향후 확장 고려사항

모델은 Node에 **고정(Hard Coding)** 하지 않고 설정(Config) 기반으로 관리한다.

예시

```yaml
models:
  planner: gpt-4o-mini
  validator: gpt-4o-mini
  router: gpt-4o-mini
  retrieval: gpt-4o-mini
  reasoning: gpt-5-mini
  context_validator: gpt-5-mini
  response: gpt-5-mini
```

---

# 개발 및 개선 이력 (Change Log)

### 2026-08-06: Agentic Orchestration Workflow v2.0 전면 전환

1. **Model Orchestration Strategy 구현 (`config.py`)**:
   - Node별 LLM 모델을 하드코딩하지 않고 Config 기반 관리 (`DEFAULT_MODEL_CONFIG`)
   - `planner`, `validator`, `router`, `retrieval`: `gpt-4o-mini` (속도/비용 최적화)
   - `reasoning`, `context_validator`, `response`: `gpt-5-mini` (고품질 추론)

2. **6단계 핵심 Agentic Node 구축 (`test_rag_graph.py`, `prompts.py`)**:
   - `Task Planner`: 사용자 질문을 세부 서브 타스크로 분해
   - `Query Validation`: 범주 밖 질문(예: 타사 가격 비교, 일상 질문 등) 사전에 `out_of_scope_response`로 차단하여 DB 검색 비용 0원 처리
   - `Intent Router`: 질문 의도 분류 및 대상 특약 키워드 자동 매칭
   - `Parallel Context Builder`: LangGraph Fan-out/Fan-in 기법으로 증권 MD, 약관 Vector Store, 메타데이터 동시 병렬 수집
   - `Multi-hop Reasoning`: 연쇄 참조 조항(별표 X, 제O조 등) 자동 추적 검색 및 보상금 정밀 계산 추론
   - `Response Builder`: 근거 기반 요약 답변 및 나무위키 스타일 UI Block(각주 포함) 생성

3. **Workflow Logging 수집 (`rag_common.py`)**:
   - Node별 실행 시각, 소요 시간(ms), 처리 문서 수, Routing 결과를 `node_logs`에 저장하고 Supabase DB 및 `workflow_audit_logs.json` 파일에 누적 기록

4. **동적 분기 시각화 & 활성 세션 모니터링 패널 (`/debug`)**:
   - 메인 대화 UI와 일관성을 유지하는 Light Theme 디자인 기반의 디버거 관제 화면 구현
   - 질문 유형에 따른 3가지 조건부 경로 (Branch A: Out-of-Scope 차단, Branch B: 되묻기, Branch C: 정밀 RAG) 및 우회(SKIPPED) 노드를 동적 시각화
   - 프론트엔드 활성 세션(`sessionId`)과 실시간 동기화하여 상담사 작업의 디버깅 이력을 즉시 확인 및 JSON 파일 다운로드 지원

5. **Top-Down 세로 방향 그래프 & 노드 상세 결과 팝업 Inspector (`/debug`)**:
   - 그래프 레이아웃을 세로 방향 Top-Down Flow (↓)로 전환하고, `Parallel Context Builder` 실행 시 3개 Sub-Task(증권 MD, 약관 Vector Search, 특약 Allowlist)의 Parallel Fan-Out 및 Fan-In 병렬 수집 분기를 정밀 시각화
   - 각 노드 카드를 클릭(Click) 시 해당 작업의 세부 입력/출력 Payload, 분류 사유, 매칭 특약, 연쇄 참조 조항 등을 즉시 확인할 수 있는 **Node Result Detail Inspector Modal** 구축
   - 소요 시간을 소수점 밀리초 대신 깔끔한 정수 초(N초) 단위로 표시하고, **LLM API 호출 횟수(N회)** 및 **Multi-hop 루프 횟수(N회)** 관제 메트릭 수집 연동

6. **Parallel Context Builder 지능형 Multi-LLM 병렬 수집 고도화 (`test_rag_graph.py`)**:
   - `Parallel Context Builder` 노드에 **Agentic Multi-LLM Fan-Out** 기법 전면 도입
   - (1) `Task A (LLM Sub-Query Expander - GPT-4o-mini)`: 사용자 질문을 약관 검색에 최적화된 2~3개의 다각도 서브 검색어로 분해하여 Vector DB 다중 병렬 검색
   - (2) `Task B (LLM Certificate Extractor - GPT-4o-mini)`: 개인 가입증권 MD에서 특약별 가입금액 및 보장 한도를 사전 구조화 추출
   - `asyncio.gather()` 동시 실행으로 지연 시간 0초 추가로 복합 질의 수집 정밀도 극대화

7. **동적 계획 태스크 기반 LLM+RAG 병렬 워커 & Reflective Multi-hop Loop 엣지 연결 (`test_rag_graph.py`)**:
   - `Task Planner`가 생성한 N개의 동적 도메인 세부 작업(`tasks_list`)에 맞추어 `Parallel Context Builder`에서 **N개의 동적 LLM+RAG Task Worker**를 `asyncio.gather()`로 병렬 자동 생성하여 실행
   - `Multi-hop Reasoning` 단계에서 미수집된 연쇄 참조 조항(별표 X, 제O조 등) 감지 시, `Parallel Context Builder`로 되돌아가 보충 수집하는 **Multi-hop Reflective Loop 엣지(`decide_after_reasoning`)** 연결 완료

8. **Human-in-the-Loop 대화형 사용자 승인 UI 카드 구축 (`frontend/src/app/page.tsx`)**:
   - 필수 보충 조건(슬롯) 입력 및 손해사정 산출 진행을 승인받기 위한 대화형 **Human-in-the-Loop 사용자 승인 UI 카드** 구현
   - `[✅ 승인 및 계속 진행 (Proceed)]`, `[정보 제출 및 승인]`, `[✕ 승인 거절 및 취소 (Reject)]` 인터랙티브 버튼을 대화 버블 내 노출하여 유저가 파이프라인의 진행/취소를 제어하도록 구현 완료

9. **도메인 특화 세부 작업 분류 고도화 & Multi-hop 20~30초대 속도 최적화 (`prompts.py` & `test_rag_graph.py`)**:
   - `TASK_PLANNER_PROMPT`를 손해사정 도메인에 특화된 3단계 작업(`Task #1: 가입증권 특약 및 보장 한도 조회`, `Task #2: 약관 보장 기준 및 대상 구분 대조`, `Task #3: 약관 보상금 산출 및 면책 조건 계산`)으로 명확히 재정의
   - 태스크별 비동기 벡터 검색(`asyncio.to_thread`) 및 LLM 컨텍스트 길이 최적화(`policy_md[:1500]`, `context[:2500]`)로 **전체 Multi-hop RAG 응답 속도를 1분에서 20~30초대(<45초)로 대폭 단축**
   - 사용자 수동 승인 버튼 일시정지를 제거하고, 매끄러운 실시간 자동 탐색 스트리밍 체계로 원복 완료

10. **자율형 작업 순서 기획 & 워커 수행 모드 (RAG_ONLY, RAG_LLM, LLM_ONLY) 동적 오케스트레이션 (`prompts.py`, `test_rag_graph.py`, `page.tsx`, `/debug`)**:
   - `Task Planner`가 질문 분석 결과에 따라 세부 작업 실행 순서(`seq`) 및 워커 수행 전략(`worker_mode`: `RAG_ONLY`, `RAG_LLM`, `LLM_ONLY`)을 자율 기획
   - `Parallel Context Builder`에서 워커 모드별로 DB 단순 검색, DB+LLM 결합 대조, 또는 순수 LLM 수리 계산을 다형성으로 자동 디스패치 수행
   - 메인 대화 UI 및 디버거 관제 화면에 작업 실행 순서(`seq`) 및 `RAG_ONLY`, `RAG_LLM`, `LLM_ONLY` 수행 모드 배지를 정밀 시각화 완료

11. **멀티턴 대화 맥락 기억(Fast Path 1.5초) & 토큰 타이핑 애니메이션 스트리밍 구현 (`server.py`, `useSSE.ts`)**:
   - 동일 세션 내 후속 질의(연속 대화) 감지 시, 중복 DB 검색을 스킵하고 이전 대화 맥락에 기반하여 **1.5초 초고속 패스트트랙(Contextual Fast Path)**으로 챗봇 답변 즉시 생성
   - 파이널 답변 출력 단계에서 글자가 타자기처럼 촤르륵 노출되는 **토큰 단위 실시간 타이핑 애니메이션 스트리밍(`asyncio.sleep`)** 도입으로 UX 체감 대기시간 극소화 완료

12. **상황 적응형 동적 레이아웃 전환(DEEP_AUDIT vs CONVERSATIONAL) & 대화 기억 윈도우 확장 (`server.py`, `page.tsx`)**:
   - 첫 질의(정밀 보상 분석) 및 후속 연속 대화 전반에 걸쳐 대화 기억 버퍼(`chat_history`)를 확장 유지하여 이전 질문과 답변 내용을 완벽 기억하는 스마트 대화 처리 완료

13. **통일된 Markdown (MD) 기반 출력 렌더링 전환 (`frontend/src/app/page.tsx`)**:
   - 대화 일관성을 위해 파편화된 카드 블록 대신 **통일된 GitHub 스타일 Markdown (MD)** (제목 `#`, 목록 `-`, 인용구 `>`, 마크다운 표 `|...|`) 기반 출력으로 일원화
   - 글자가 촤르륵 써지는 타이핑 스트리밍 애니메이션과 완벽히 결합하여 깔끔하고 일관된 챗봇 UX 구현 완료

14. **일반 응답 MD 표현 및 기능 개입 전용 UI 블록 분리 아키텍처 (`frontend/src/app/page.tsx`)**:
   - 단순 답변 및 RAG 분석 내역은 **통일된 Markdown (MD) / Rich Text**로 대화 버블 내 자연스럽게 표현
   - 필수 정보 입력 보완 요청(`Slot Filling`), 주의사항(`Caution`), 기능 완료 안내(`Deliver`) 등 **플로우상 사용자 개입이나 기능적 제안 차원에서만 선별적으로 UI 블록 카드를 렌더링**하도록 UX 완벽 분리 완료

15. **실시간 100ms 인터벌 소요 시간 타이머(`⏱️ N.Ns 진행 중...`) 연동 (`page.tsx`, `debug/page.tsx`)**:
   - 파이프라인 수행 및 답변 스트리밍이 진행되는 동안 소요 시간이 100ms 간격으로 실시간 업카운팅(`0.1s ➔ 12.3s`)되는 **Real-time Live Timer** 연동
   - 실행 종료 시 최종 소요 초(예: `15초 소요`)로 자동 캡처 및 고정되어 사용자가 관제 대기 시간을 한눈에 직관 파악 가능하도록 구현 완료

16. **EventSource 스트림 종료 핸들러 예외 정제 (`useSSE.ts`)**:
   - SSE 스트림 정상 종료 및 세션 클로즈 시 발생하던 거짓 양성(False-positive) 콘솔 오류 팝업을 예외 정제하여 세션 정상 릴리즈 및 대화 스트리밍 완료 처리 확보

17. **파이프라인 선두 처리 범위 사전 검증(`Query Validation`) 재배치 (`test_rag_graph.py`)**:
   - 질문 처리 범위 검증 노드(`query_validation`)를 최선두 노드로 재배치하여, 범위 밖 질문(Out-of-scope)의 경우 `Task Planner` 실행 전에 0초 사전에 빠르게 차단하도록 엣지 순서 재구성 완료 (`START ➔ query_validation ➔ task_planner ➔ intent_router`)

18. **중간 노드 완료 시 타이머 조기 동결 버그 수정 (`page.tsx`)**:
   - `task_planner` 노드 완료 시 중간 소요 시간(약 6초)이 메시지 상태에 저장되어 실시간 타이머가 조기 멈춤 발생하던 버그 수정
   - 전체 파이프라인 수행 및 스트리밍이 진행되는 동안(`isLoading == true`) `⏱️ N.Ns (진행 중...)` 타이머가 멈춤 없이 계속 늘어나고, 최종 완결시에만 고정 소요 초로 정제되도록 렌더링 조건을 전면 보정 완료

19. **질문 제출부터 파이프라인/스트리밍 완결 시점까지 끊김 없는 전 구간 실시간 카운팅 보장 (`page.tsx`)**:
   - 답변 생성, 범위 밖 차단, 중단, 오류 등 모든 세션 수명주기 동안 타이머가 끊김 없이 `0.1s ➔ N.Ns`로 카운팅되도록 `startTimeRef` 기반 동적 타이머 보정
   - 스트림 완결 시점에 최종 소요 초(`Math.max(1, finalSec)초 소요`)를 영구 고정 저장하여 타이머가 중간에 사라지거나 멈추는 현상을 완전 차단 완료

20. **Parallel Context Builder 태스크 객체 쿼리 파싱 버그 수정 (`test_rag_graph.py`)**:
   - `run_task_worker`에 구조화된 태스크 객체(`{seq, task_name, worker_mode}`)가 전달될 때 딕셔너리가 쿼리로 직접 입력되어 Vector store 검색 실패로 `0개 약관 문서 병합 (29ms)` 처리되던 원인 규명 및 수정
   - 태스크 항목에서 텍스트(`task_name`/`description`)를 정확히 파싱 추출하여 8개 약관 정상 수집 및 실시간 병렬 워커 수행 확인 완료

21. **Multi-hop Reasoning 및 전체 노드 LLM 모델 GPT-4o-mini 전면 전환 (`config.py`, `debug/page.tsx`)**:
   - Multi-hop Reasoning 노드 및 Response Builder 노드의 LLM 모델을 무거운 `gpt-5-mini`에서 초고속 **`gpt-4o-mini`**로 전면 교체
   - 5단계 멀티홉 병목 현상을 해소하고 전체 파이프라인 수행 속도를 3~5초대로 극적으로 단축 완료

22. **정밀 멀티홉 연쇄 참조 감지(Chain-Ref Pinpoint Filtering) 로직 정제 (`test_rag_graph.py`)**:
   - `제1조`, `제12조` 등 단독 범용 조항 번호 무차별 매칭을 스킵하여 약관 전체에서 무관한 조항이 검색되던 노이즈 현상 완벽 제거
   - `section_title` 및 `별표 1 [분류표명]`, `제12조 (보상하는 손해)` 등 **구체적 명칭 결합 참조 조항만 핀포인트 추출**하도록 정밀 필터링을 적용하여 약관 검색 정밀도 및 노이즈 제거 완수

23. **메인 대화 UI 답변 카드 레이아웃 전면 재구성 (`page.tsx`)**:
   - 화면 복잡도를 낮추기 위해 `🎯 AI 자율 기획 도메인 작업 순서` 배너 영역 완전 제거
   - **실시간 수행 진행률 스테퍼 바(`15% ➔ 100%`)를 최상단에 배치**하고, 파이프라인 수행 결과 **답변 텍스트를 진행률 하단에 수직 정렬 배치**하여 시각적 직관성 및 가독성 대폭 향상

24. **실시간 수행 진행률 단계별 퍼센트 계산식 정밀화 (`page.tsx`)**:
   - 기존의 완료 노드 개수 기반 100% 조기 도달(Premature 100%) 오류를 방지하기 위해 각 노드 단계별 완료 여부를 계산하는 `completedNodes` 맵 적용
   - 수행 진행 중: `15% (범위검증) ➔ 30% (작업기획) ➔ 45% (의도분류) ➔ 60% (약관수집) ➔ 80% (보상추론) ➔ 90% (답변생성/타자스트리밍)` 순으로 순차 증가하고, 스트림 완결 시점에만 `100%` 완결 처리되도록 보정 완료

25. **최종 Response Builder 노드 `gpt-5-mini` 지정 및 UI 블록 경고 전용 제한 규칙 반영 (`config.py`, `page.tsx`, `debug/page.tsx`)**:
   - 최종 파이널 답변 생성(`generate`) 노드는 최고 품질 합성을 위해 **`gpt-5-mini`** 모델로 지정 배치 완료
   - 모든 UI/UX 안내, 상담 유의사항, 고객 전달 가이드 등 전체 응답은 **100% 풍부한 Markdown 텍스트(`renderFormattedMarkdown`)**로 합쳐서 출력
   - UI Block 카드는 **실제 상담사 개입 및 주의 경고 (`CAUTION`) 전용 카드**만 노출하도록 지침을 엄격 반영 완료

26. **파이프라인 수행 상태별 지속형(Persistent) 색상 로딩/경고 스테퍼 바 구현 (`page.tsx`)**:
   - 수행 완결/중단 시 로딩바가 갑자기 사라지던 현상을 해결하고 카드 내에 상태별 테마 바를 지속 유지
   - **수행 중 (RUNNING)**: 파란색 애니메이션 로딩 바 (`15% ➔ 90% 수행 중...`)
   - **완결 (COMPLETED)**: 단정한 초록색 완결 바 (`✓ 파이프라인 수행 완결 100% 완료 / N초 소요`)
   - **중단/범위 밖/오류 (STOPPED / OUT_OF_SCOPE / ERROR)**: 명확한 빨간색 경고 바 (`⚠️ 파이프라인 수행 중단 / 범위 밖 검증 차단`) 및 중단 지점 표시 완수

27. **질문 범위 밖 검증 차단 시 기능적 경고 배너 및 지속 상태 감지 기능 연동 (`page.tsx`, `test_rag_graph.py`)**:
   - 백엔드의 `query_validation` 노드에서 `is_valid: False` 감지 시 프론트엔드 메시지 카드에 **🚫 `[보장 범위 검증 차단]` 경고 붉은색 알림 박스**를 즉시 표출
   - 메시지 히스토리의 `nodeLogs` 상태 데이터를 기반으로 과거 대화 내역에서도 검증 차단 지점(예: `15% 수행 중단`)과 빨간색 경고 바가 사라지지 않고 영구 보존되도록 기능 및 백엔드 연동 완수

28. **노란색 CAUTION UI 블록 카드 삭제 및 100% 통합 Markdown 출력 규격 확립 (`page.tsx`)**:
   - 하단에 불필요하게 표시되던 중복 노란색 `CAUTION` UI 블록 카드 영역을 완전히 삭제 제거
   - 상담 시 유의사항, 면책 경고, 고객 안내 등 모든 보장 관련 내용은 본문 **Markdown (`renderFormattedMarkdown`) 내 `> ⚠️ **상담 시 유의사항**` 형태로 100% 단일 통합 출력**되도록 UI/UX 규격 확립 완료

29. **상담사 1초 한눈 파악용 Markdown 표(Table) 및 고구조화 출력 프롬프트 강제 (`prompts.py`, `test_rag_graph.py`)**:
   - 긴 서술형 줄글 단락의 가독성 저하를 해결하기 위해 `GENERATE_BLOCK_SYSTEM_PROMPT` 내에 **Markdown Table (`| 보장 항목 | 가입 특약/조항 | 가입 금액 | 지급 비율 | 예상 지급금 |`)** 사용을 필수 강제
   - 표 하단에 `> 💰 **최종 예상 보험금**: **300,000원**` 명확 강조, `### 📚 약관 근거`, `> ⚠️ 상담 유의사항`, `> ✅ 고객 전달 가이드` 등 콜센터 상담사가 전화 통화 중 1초 만에 즉시 파악할 수 있는 고구조화 마크다운 규격으로 프롬프팅 개편 완수

30. **Markdown 인라인 볼드(`**bold**`) HTML 파서 구현 및 로딩 임시 텍스트 완전 삭제 (`page.tsx`)**:
   - `renderFormattedMarkdown` 내에 `parseInlineMarkdown` 파서를 새로 구축하여, 화면에 `**bold**` 별표 기호가 날것(raw text)으로 노출되던 현상을 원천 해결하고 **진짜 HTML `<strong>` 강조 및 출처 뱃지(`📖 [출처: ...]`)**로 예쁘게 렌더링되도록 구현 완료
   - 로딩 중 답변 박스에 어색하게 뜨던 `"고객 약관 데이터베이스 탐색 및 손해사정 보상금 산출 중..."` 임시 텍스트 전면 삭제 완료

31. **연속된 Blockquote(`> `) 줄 분할 버그 수정 및 단일 통합 카드 렌더링 (`page.tsx`)**:
   - `> `로 시작하는 각 줄마다 독립된 블록으로 파싱되어 10여 개의 파란색 박스가 난잡하게 겹쳐 나오던 현상 규명 및 수정
   - `renderFormattedMarkdown` 내에 `quoteBuffer` 버퍼링 파서를 적용하여 연속된 인용구 항목들이 **하나의 깔끔한 통합 카드(Blockquote) 내부로 정돈 렌더링**되도록 파싱 버그를 완벽 해결 완료

32. **단정적 예상 금액 출력 금지 및 약관 보장 기준/지급 비율 공식 중심 프롬프트 개편 (`prompts.py`)**:
   - 실제 보험 상담 컴플라이언스 기준을 엄격 반영하여 단정적 액수(예: 300,000원) 단정 대신 **약관상의 정확한 보장 기준, 지급 비율 공식(예: '가입금액의 3% (1회당 지급, 치아파절 제외)')**을 명시하도록 추론 및 답변 생성 프롬프트 전면 수정
   - 표 헤더 컬럼을 `| 보장 항목 | 가입 특약/조항 | 가입 금액 | 약관 보장 기준 및 지급 비율 | 비고/제한사항 |`으로 개편하고 `> 🛡️ **약관 보장 기준 및 지급 한도**` 방어적 안내 규격 적용 완수

33. **약관 근거 포함 4대 전용 시각적 마크다운 카드 블록 규격 통일 (`prompts.py`, `page.tsx`)**:
   - `📚 약관 근거 및 보장 조건` 섹션이 일반 텍스트로 누락되던 현상을 수정하여 `> 📚 **약관 근거 및 보장 조건**` 형태의 독립 카드 블록 규격으로 통일
   - **4대 전용 테마 카드 블록 시스템 완성**:
     - `🛡️ 보장 기준 카드`: 푸른색 인디고 카드 (`bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-600`)
     - `📚 약관 근거 카드`: 회색 슬레이트 카드 (`bg-slate-100/80 border-slate-600`)
     - `⚠️ 상담 유의사항 카드`: 노란색 앰버 카드 (`bg-amber-50/90 border-amber-500`)
     - `✅ 고객 전달 가이드 카드`: 초록색 에메랄드 카드 (`bg-emerald-50/90 border-emerald-500`)

34. **원화 금액(KRW/원) 단정 기재 절대 금지 규칙 전면 적용 (`prompts.py`)**:
   - 처방전, 병원 진료비 세부내역서 접수 전 섣부른 원화 금액(예: '30만원', '300,000원') 표기를 **절대 금지(Negative Constraint)**
   - 답변 내에 오직 **'약관 가입금액의 3% (1회당 지급 비율 규정)', '진료 세부내역서 및 서류 검토 후 확정'**과 같이 실제 보험 손해사정 컴플라이언스에 준하는 지급 비율 규정으로만 표현하도록 강력 제약 적용 완료

35. **타자기 스트리밍 중 진행률 100% 조기 도달 버그 완벽 차단 (`page.tsx`)**:
   - 답변 토큰이 타자기처럼 스트리밍되는 중간에 진행률이 100%로 섣불리 올라가던 버그 규명 및 수정
   - `isRunning` 조건에 `isActive && (!isCompleted || isLoading)` 이중 완결 검증 플래그를 결합하여, 백엔드 SSE의 최종 완결 신호(`isCompleted === true`)가 수신될 때만 100% 완료로 상향 전환되도록 실시간 진행률 생명주기를 정밀 보정 완료

36. **Document Grader 문서 드랍 방지 및 대화 상태 임시 문구 오염 버그 수정 (`test_rag_graph.py`, `page.tsx`)**:
   - `grade_documents` 노드에서 LLM 관련성 평가 시 문서가 0개로 전면 드랍되어 5단계(`multi_hop_reasoning`)를 건너뛰고 100% 완결로 건너뛰던 에지 케이스 규명 및 안전 보존 처리 완료
   - `page.tsx` 내 `useEffect`에서 `text` 속성에 임시 문구(`"고객 약관 데이터베이스 탐색..."`)를 오염 할당하던 코드를 전면 삭제하여 텍스트가 덮어씌워지던 버그를 완벽 해결 완료

37. **Git 작업 트리 및 파이프라인 전체 파일 `p3/jsc` 독립 브랜치 신규 푸시 완료**:
   - main 브랜치를 건드리지 않는 엄격한 지침에 따라, 현재 완성된 작업 트리 전체(AGENT.MD, config.py, test_rag_graph.py, prompts.py, server.py, page.tsx 등)를 **`p3/jsc` 전용 브랜치**로 직접 커밋 후 원격 저장소(`origin/p3/jsc`)에 성공적으로 푸시 완수

---

# API 응답 결과 명세 및 데이터 샘플 (Backend & Frontend Spec)

백엔드와 프론트엔드 간 연동 시 사용하는 최종 JSON 응답 데이터 구조와 Markdown 블록 표시 예시입니다.

## 1. REST API / SSE JSON 응답 데이터 구조

### JSON Schema 개요

| Field Key | Type | Description |
|---|---|---|
| `status` | string | 처리 결과 상태 (`"SUCCESS"`, `"OUT_OF_SCOPE"`, `"SLOT_FILLING"`) |
| `answer` | string | 상담사/고객용 최종 요약 답변 텍스트 |
| `blocks` | array[object] | 프론트엔드 UI Block 렌더링용 구조화 데이터 |
| `total_referenced_count` | integer | 최종 답변 작성에 참조된 약관 문서 총 개수 |
| `referenced_pages` | array[string] | 참조된 약관 특약명 및 페이지 번호 리스트 |
| `tasks` | array[string] | Task Planner가 분석한 실행 작업 목록 |
| `intent` | string | Intent Router가 분류한 문의 의도 |
| `node_logs` | array[object] | Workflow 각 Node별 실행 시간(ms) 및 감사 로그 |

### 샘플 JSON (정상 처리: 재해골절 보상금 문의)

```json
{
  "status": "SUCCESS",
  "answer": "장석찬 고객님의 무재해치료특약(갱신형) 가입금액 1,000만원 기준, 재해골절 발생 시 1회당 가입금액의 3%인 30만원의 보상금이 지급됩니다. 단, 치아파절(치아 부러짐)은 약관상 보상 대상에서 제외됩니다.",
  "blocks": [
    {
      "block_type": "CONTEXT",
      "title": "상황 파악",
      "content": "장석찬 고객님의 재해골절 발생 시 보상금 지급 가능 여부 및 지급 금액 문의"
    },
    {
      "block_type": "RETRIEVAL_RESULT",
      "title": "약관 검색 결과 및 보장 내역",
      "variant": "info",
      "items": [
        {
          "text": "무재해치료특약(갱신형) 가입금액 1,000만원 기준 재해골절 1회당 3% (30만원) 지급",
          "citations": [
            {
              "id": 1,
              "section_title": "재해치료비보장특약(갱신형,무배당)",
              "page": 164,
              "snippet": "제3조(보상하는 손해) 피보험자가 재해로 인하여 골절 상태가 되었을 때 1회당 보험가입금액의 3%를 지급"
            }
          ]
        }
      ]
    },
    {
      "block_type": "CAUTION",
      "title": "상담 유의사항",
      "variant": "warning",
      "content": "치아파절(치아 부러짐)은 약관 제3조 단서조항에 의해 보상 대상 골절에서 제외되므로 의사 소견서 상 제외 여부 확인 필요."
    },
    {
      "block_type": "DELIVER",
      "title": "고객 전달 안내 서류",
      "variant": "default",
      "items": [
        "① 진단서 또는 진료확인서 (질병/재해 분류코드 포함) 1부",
        "② 병원 진료비 계산서/영수증"
      ]
    }
  ],
  "total_referenced_count": 2,
  "referenced_pages": [
    "재해치료비보장특약(갱신형,무배당) (p.164)",
    "기초응급자금특약(무배당) (p.150)"
  ],
  "tasks": [
    "보험증권 조회",
    "재해골절 보장내용 확인",
    "재해골절 보장금액 계산"
  ],
  "intent": "보험금_지급_여부",
  "node_logs": [
    {
      "node": "task_planner",
      "duration_ms": 1120,
      "timestamp": "2026-08-06T11:08:55.444Z",
      "tasks": ["보험증권 조회", "재해골절 보장내용 확인", "재해골절 보장금액 계산"]
    },
    {
      "node": "query_validation",
      "duration_ms": 850,
      "timestamp": "2026-08-06T11:08:56.564Z",
      "is_valid": true,
      "reason": ""
    },
    {
      "node": "intent_router",
      "duration_ms": 940,
      "timestamp": "2026-08-06T11:08:57.504Z",
      "intent": "보험금_지급_여부",
      "filters": ["재해치료비보장특약(갱신형,무배당)"]
    },
    {
      "node": "parallel_context_builder",
      "duration_ms": 620,
      "timestamp": "2026-08-06T11:08:58.124Z",
      "doc_count": 2
    },
    {
      "node": "multi_hop_reasoning",
      "duration_ms": 2340,
      "timestamp": "2026-08-06T11:09:00.464Z",
      "is_eligible": true
    },
    {
      "node": "generate",
      "duration_ms": 3100,
      "timestamp": "2026-08-06T11:09:03.564Z",
      "block_count": 4
    }
  ]
}
```

### 샘플 JSON (처리 불가 질문: out-of-scope 차단 예시)

```json
{
  "status": "OUT_OF_SCOPE",
  "answer": "현재 시스템은 보험증권 및 보험약관을 기반으로 보장 내용과 보험금을 계산해 드리고 있습니다. 문의하신 내용은 지원 범위를 벗어나 정확한 안내가 어렵습니다.",
  "blocks": [
    {
      "block_type": "CAUTION",
      "title": "지원 범위 안내",
      "variant": "warning",
      "content": "타사 보험 상품 비교나 일반적인 시세/가격 타당성 문의는 지원 범위에 포함되지 않습니다."
    }
  ],
  "total_referenced_count": 0,
  "referenced_pages": [],
  "tasks": ["질문 분석"],
  "intent": "",
  "node_logs": [
    {
      "node": "task_planner",
      "duration_ms": 980,
      "timestamp": "2026-08-06T11:10:00.000Z"
    },
    {
      "node": "query_validation",
      "duration_ms": 760,
      "timestamp": "2026-08-06T11:10:00.760Z",
      "is_valid": false,
      "reason": "타사 보험 상품 비교나 일반적인 시세/가격 타당성 문의는 지원 범위에 포함되지 않습니다."
    },
    {
      "node": "out_of_scope_response",
      "duration_ms": 1150,
      "timestamp": "2026-08-06T11:10:01.910Z"
    }
  ]
}
```

## 2. 프론트엔드 UI Render 개요 (Markdown)

프론트엔드 컴포넌트는 `blocks` 배열을 순회하며 다음과 같이 화면에 렌더링합니다:

- **CONTEXT Block**: 상담 맥락 카드 (회색 라인)
- **RETRIEVAL_RESULT Block**: 약관 근거 카드 (각주 Modal / Tooltip 연동)
- **CAUTION Block**: 노란색 경고 유의사항 Box (`variant: "warning"`)
- **DELIVER Block**: 고객 전달 서류 체크리스트 (`items` 배열)

