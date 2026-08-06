# 📄 Finance QA: 보험약관 구조화 & Supabase(pgvector) Agentic RAG 파이프라인

PDF 형식의 보험약관 문서를 목차(TOC) 기준으로 파싱하여 JSON 데이터로 구조화하고, **Supabase(pgvector) Vector DB** 와 **LangGraph 기반 Agentic RAG 파이프라인**을 구축하는 자동화 시스템입니다.

> 📌 오늘까지의 상세 변경 이력(발견한 버그, 아키텍처 결정 이유, 시스템 아키텍처 다이어그램)은 [modify.md](modify.md)에 정리되어 있습니다.

---

## 📌 주요 기능

1. **작업(Task) 관리**: 고객/약관별 작업 폴더 자동 세팅 (`tasks/{task_name}/`)
2. **PDF 구조화 파싱**: `toc_config.csv` 및 PyMuPDF를 기반으로 PDF 약관을 목차/섹션별 1차 JSON으로 분할 파싱 (2단/단일 컬럼 레이아웃 자동 판별)
3. **최종 JSON 병합**: 1차 검토가 완료된 파싱 데이터를 단일 통합 JSON 파일로 병합
4. **Vector DB 구축**: OpenAI `text-embedding-3-small` 모델과 **Supabase(pgvector)** 를 활용한 벡터 데이터베이스 구축. 여러 인물의 데이터를 한 테이블에 `task_name`으로 격리해서 저장하므로 서버리스(Vercel) 배포에도 그대로 씁니다.
5. **Agentic RAG Q&A 파이프라인**: LangGraph 기반으로 "질문→관련 특약 자동 분류→벡터 검색→검색결과 관련성 평가→(부족하면) 질문 재작성 후 재검색→개인 보험증권과 대조해 실제 금액을 계산한 답변 생성"까지 처리합니다. 답변은 실시간 스트리밍으로 출력됩니다.
6. **벤치마크/회귀 테스트**: 정답을 미리 아는 검증 질문 세트를 돌려서, 답변이 실제 근거 문서에 기반했는지(hallucination 없는지) LLM으로 이중 검증하는 스크립트를 포함합니다.

---

## 📁 프로젝트 구조

```text
Finance_QA/
├── backend/
│   ├── main.py              # [준비 단계 진입점] 파이프라인 전체 실행 메인 CLI 스크립트 (pipeline/step_1~3 실행)
│   ├── pipeline/             # 온보딩 전용: 새 고객 약관이 들어올 때만 쓰는 데이터 준비 파이프라인
│   │   ├── step_1.py            # 1단계: PDF 파싱 & 목차별 1차 JSON 생성
│   │   ├── step_2.py            # 2단계: 1차 JSON 파일들을 최종 단일 JSON으로 병합
│   │   └── step_3.py            # 3단계: 최종 JSON 기반 Supabase(pgvector) Vector DB 적재
│   ├── rag_common.py         # 공용 헬퍼: 인물별 certificate.md 로드, Supabase 벡터스토어 연결
│   ├── rebuild_db.py         # 개발용 단축 스크립트: jang 한 명만 step_1~3 한 번에 재실행
│   ├── test_rag_graph.py     # [질문 단계 진입점] LangGraph 기반 Agentic RAG 엔진 (유일한 질의응답 파일)
│   ├── server.py             # FastAPI SSE 서버 (프론트엔드가 붙는 API)
│   ├── prompts.py            # 라우팅용 시스템 프롬프트
│   ├── benchmark.py          # 검증 질문 세트 + LLM grounding 재검증으로 PASS/FAIL 리포트 생성
│   └── requirements.txt      # 프로젝트(백엔드) 의존성 라이브러리 목록
├── frontend/               # Next.js 상담사 인바운드 UI (SSE로 backend/server.py에 연결)
├── db/schema.sql          # Supabase에 한 번 실행: pgvector 확장, documents/sessions/audit_logs 테이블
├── modify.md              # 변경 이력 + 시스템 아키텍처 다이어그램 (자세한 문서)
├── .gitignore             # Git 추적 제외 설정 파일 (.env 포함)
└── tasks/                 # 작업(Task) 데이터 저장 디렉토리 (backend/ 밖, 코드와 분리된 데이터)
    └── {task_name}/
        ├── inputs/             # PDF 약관 파일(raw_policy.pdf) 및 목차 설정(toc_config.csv)
        ├── parsed_json_parts/  # 목차별 분할 파싱 1차 JSON 파일들
        ├── final_output/       # 병합 완료된 최종 통합 JSON 파일
        └── certificate.md      # 그 사람 보험증권(가입금액·보장금액) 요약 markdown
```

> 벡터 데이터는 더 이상 로컬 폴더(`tasks/{name}/vector_db/`)에 저장하지 않습니다 — Supabase 클라우드 DB 하나로 통합되어 있습니다.
> `tasks/`, `pdf_policy/`, `pdf_certificate/`, `db/`는 코드가 아니라 데이터라서 `backend/` 밖(레포 루트)에 그대로 둡니다. `backend/` 안의 코드는 어디서 실행하든(`backend/`든 레포 루트든) `backend/rag_common.py`의 `TASKS_DIR` 등 절대경로 상수로 이 폴더들을 찾습니다.

---

## 🛠️ 설치 및 환경 설정

### 1. 가상환경 생성 및 의존성 설치

```bash
# 가상환경 생성 및 활성화
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# .venv\Scripts\activate   # Windows

# 필요한 패키지 설치
pip install -r backend/requirements.txt
```

### 2. 환경변수 설정 (`.env`)

프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 아래 값을 채웁니다. (이 파일은 git에 올라가지 않습니다.)

```env
# OpenAI (임베딩 + LLM)
OPENAI_API_KEY=your_openai_api_key_here

# Supabase (Project Settings > API)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_secret_key_here

# Postgres 직접 연결 문자열 (db/schema.sql 실행 시에만 필요, Supabase "Connect" > Session/Transaction pooler 권장)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
```

### 3. Supabase 스키마 적용 (최초 1회)

Supabase 대시보드 SQL Editor에서 [db/schema.sql](db/schema.sql) 내용을 그대로 실행합니다. `pgvector` 확장 활성화, `documents` 테이블, `match_documents` 검색 함수가 만들어집니다.

---

## 🚀 사용 방법 (데이터 준비 단계)

### 1. 메인 파이프라인 실행 (`backend/main.py`)

```bash
cd backend
python main.py
```

`main.py` 실행 시 제공되는 인터랙티브 메뉴를 이용합니다:

```text
==========================================
 📄 보험약관 구조화 & Vector DB 구축 파이프라인
==========================================
 1. [1단계] 새 작업 폴더 생성
 2. [2단계] PDF 파싱 & 목차별 1차 JSON 생성 (pipeline/step_1.py)
 3. [3단계] 1차 JSON 검토 후 최종 단일 JSON 병합 (pipeline/step_2.py)
 4. [4단계] 최종 JSON 기반 Vector DB 생성 (pipeline/step_3.py)
 0. 종료
==========================================
```

#### Step별 진행 단계:
1. **[1단계] 새 작업 폴더 생성**: 예시로 `jang` 또는 `kim` 등의 작업명을 입력합니다.
2. **입력 파일 준비**: `tasks/{task_name}/inputs/` 경로에 아래 두 파일 입력
   - `raw_policy.pdf`: 원본 보험약관 PDF 파일
   - `toc_config.csv`: 약관 목차 정보가 수록된 CSV 파일
3. **[2단계] PDF 파싱 (pipeline/step_1.py)**: PDF 문서와 TOC 설정을 매핑하여 섹션별 JSON 조각을 생성합니다.
4. **[3단계] 단일 JSON 병합 (pipeline/step_2.py)**: 분할 파싱된 JSON 조각들을 하나의 최종 JSON 파일로 결합합니다.
5. **[4단계] Vector DB 구축 (pipeline/step_3.py)**: 최종 JSON 데이터를 읽어 임베딩을 생성하고 **Supabase(pgvector)** 에 저장합니다. 재실행해도 그 인물의 기존 벡터를 지우고 새로 넣으므로 중복 적재되지 않습니다.
6. **(선택) 개인 보험증권 요약 추가**: `tasks/{task_name}/certificate.md`에 그 사람 증권의 가입금액·보장금액 표를 markdown으로 정리해두면, 질문 답변 시 실제 원화 금액 계산에 사용됩니다.

`jang` 한 명만 빠르게 전체 재실행하고 싶다면 (backend/ 에서) `python rebuild_db.py`로도 가능합니다.

> `pipeline/`(step_1~3)은 **기존 고객 데이터가 다 처리됐다고 필요 없어지는 게 아니라, 새 고객이 추가될 때마다 계속 쓰는 온보딩 도구**입니다. 지금 서빙 중인 질의응답(`test_rag_graph.py`, `server.py`)과는 완전히 분리된 별도 관심사라 `backend/pipeline/` 하위로 나눠뒀습니다.

### 2. 질의응답 API 서버 + 프론트엔드 실행

데이터 준비가 끝났으면, 상담사용 웹 UI로 질문할 수 있습니다.

```bash
# 1) 백엔드 (FastAPI SSE 서버, :8000)
cd backend
uvicorn server:app --reload

# 2) 프론트엔드 (Next.js, :3000) — 별도 터미널에서
cd frontend
npm install   # 최초 1회
npm run dev
```

브라우저에서 http://localhost:3000 을 열면 됩니다.

---

## 🔍 테스트 방법

### 1. 직접 질문해보기 (터미널)

Vector DB 구축이 끝났다면 `backend/test_rag_graph.py`를 바로 실행해서 질문할 수 있습니다. 답변은 실시간 스트리밍으로 출력됩니다.

```bash
cd backend

# 계속 질문을 입력받는 대화형 모드 (종료: exit / q)
python test_rag_graph.py

# 질문 하나를 바로 실행
python test_rag_graph.py "장염으로 내과에서 수액을 맞았는데 얼마나 보상받을 수 있어?"

# 미리 준비된 데모 질문 7개를 한 번에 실행
python test_rag_graph.py --demo
```

콘솔에는 라우팅(관련 특약 분류) → 검색 → 문서 평가 → 답변 생성까지 각 단계가 로그로 함께 출력되어, 어떤 근거로 답변이 만들어졌는지 확인할 수 있습니다.

### 2. 코드에서 직접 호출하기

```python
from test_rag_graph import run_agentic_rag, run_agentic_rag_json

# 터미널 출력용
run_agentic_rag("갑상선암 진단 시 보장 금액은?")

# API/화면 연동용 — JSON 문자열 반환 (질문/답변/참조 페이지 전문 포함)
result_json = run_agentic_rag_json("갑상선암 진단 시 보장 금액은?")
```

### 3. 회귀 테스트(벤치마크) 돌리기

정답을 미리 알고 있는 검증 질문 10개를 실행하고, 답변이 실제 근거 문서·증권과 부합하는지(hallucination 없는지) 별도 LLM으로 재검증한 뒤 PASS/FAIL 리포트를 만듭니다.

```bash
cd backend
python benchmark.py
```

결과는 `benchmark_results.json`에 저장되고, 콘솔에 질문별 PASS/FAIL·판정 이유·소요시간이 출력됩니다. `test_rag_graph.py`나 프롬프트를 수정한 뒤 정확도가 안 떨어졌는지 확인하는 용도로 재사용하시면 됩니다.

---

## 📜 라이선스

This project is open-source.
