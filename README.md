# 📄 Finance QA: 보험약관 구조화 & Vector DB / RAG 구축 파이프라인

PDF 형식의 보험약관 문서를 목차(TOC) 기준으로 파싱하여 JSON 데이터로 구조화하고, **Chroma Vector DB** 및 **LangChain/OpenAI RAG 파이프라인**을 구축하는 자동화 시스템입니다.

---

## 📌 주요 기능

1. **작업(Task) 관리**: 고객/약관별 작업 폴더 자동 세팅 (`tasks/{task_name}/`)
2. **PDF 구조화 파싱**: `toc_config.csv` 및 PyMuPDF를 기반으로 PDF 약관을 목차/섹션별 1차 JSON으로 분할 파싱
3. **최종 JSON 병합**: 1차 검토가 완료된 파싱 데이터를 단일 통합 JSON 파일로 병합
4. **Vector DB 구축**: OpenAI `text-embedding-3-small` 모델과 ChromaDB를 활용한 벡터 데이터베이스 구축
5. **RAG Q&A 파이프라인**: LangChain 기반 유사도 검색 및 `gpt-4o-mini` 모델을 통한 보험 약관 전문 Q&A 답변 및 인용 출처(JSON) 생성

---

## 📁 프로젝트 구조

```text
Finance_QA/
├── main.py              # 파이프라인 전체 실행 메인 CLI 스크립트
├── step_1.py            # PDF 파싱 & 목차별 1차 JSON 생성 스크립트
├── step_2.py            # 1차 JSON 파일 검토 및 최종 JSON 병합 스크립트
├── step_3.py            # 최종 JSON 기반 Chroma Vector DB 구축 스크립트
├── test_rag.py          # RAG 기반 Q&A 및 참조 페이지 JSON 출력 테스트 스크립트
├── test_search.py       # Vector DB 유사도 검색 테스트 스크립트
├── requirements.txt     # 프로젝트 의존성 라이브러리 목록
├── .gitignore           # Git 추적 제외 설정 파일
└── tasks/               # 작업(Task) 데이터 저장 디렉토리
    └── {task_name}/
        ├── inputs/             # PDF 약관 파일(raw_policy.pdf) 및 목차 설정(toc_config.csv)
        ├── parsed_json_parts/  # 목차별 분할 파싱 1차 JSON 파일들
        ├── final_output/       # 병합 완료된 최종 통합 JSON 파일
        └── vector_db/          # 임베딩 처리된 Chroma Vector DB 저장소
```

---

## 🛠️ 설치 및 환경 설정

### 1. 가상환경 생성 및 의존성 설치

```bash
# 가상환경 생성 및 활성화
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# .venv\Scripts\activate   # Windows

# 필요한 패키지 설치
pip install -r requirements.txt
```

### 2. 환경변수 설정 (`.env`)

프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 OpenAI API 키를 설정합니다.

```env
OPENAI_API_KEY=your_openai_api_key_here
```

---

## 🚀 사용 방법

### 1. 메인 파이프라인 실행 (`main.py`)

```bash
python main.py
```

`main.py` 실행 시 제공되는 인터랙티브 메뉴를 이용합니다:

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

#### Step별 진행 단계:
1. **[1단계] 새 작업 폴더 생성**: 예시로 `jang` 또는 `kim` 등의 작업명을 입력합니다.
2. **입력 파일 준비**: `tasks/{task_name}/inputs/` 경로에 아래 두 파일 입력
   - `raw_policy.pdf`: 원본 보험약관 PDF 파일
   - `toc_config.csv`: 약관 목차 정보가 수록된 CSV 파일
3. **[2단계] PDF 파싱 (step_1.py)**: PDF 문서와 TOC 설정을 매핑하여 섹션별 JSON 조각을 생성합니다.
4. **[3단계] 단일 JSON 병합 (step_2.py)**: 분할 파싱된 JSON 조각들을 하나의 최종 JSON 파일로 결합합니다.
5. **[4단계] Vector DB 구축 (step_3.py)**: 최종 JSON 데이터를 읽어 임베딩을 생성하고 Chroma Vector DB에 저장합니다.

---

## 🔍 RAG Q&A 테스트

Chroma Vector DB 구축 완료 후, 약관 기반 Q&A 테스트를 진행할 수 있습니다.

```bash
python test_rag.py
```

- 질문 입력 시 ChromaDB 유사도 검색을 통해 관련 약관 페이지를 추출하고, LLM(`gpt-4o-mini`)이 답변 및 관련 페이지 정보를 구조화된 JSON 결과로 출력합니다.

---

## 📜 라이선스

This project is open-source.
