# [RAG 데모 ③: 고급 에이전트형(LangGraph)] 질문 -> 관련 특약 자동 분류(라우팅) -> 검색 ->
# 검색결과 관련성 평가 -> (부족하면) 질문 재작성 후 재검색 -> 최종 답변, 순서로 동작하는
# 멀티스텝 RAG. 셋 중 가장 정교하지만 그만큼 LLM 호출도 여러 번 일어납니다.
import os
import json
import csv
from typing import List, Dict, Any, Literal, TypedDict
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser

from langgraph.graph import StateGraph, START, END

from rag_common import get_embeddings, get_vectorstore, load_policy_md as _load_policy_md

# .env 파일 로드
load_dotenv()

TASK_NAME = "jang"
CSV_PATH = f"tasks/{TASK_NAME}/inputs/toc_config.csv"

# ==========================================
# 1. State 정의
# ==========================================
class AgentState(TypedDict):
    question: str
    section_filters: List[str]
    documents: List[Document]
    generation: str
    loop_count: int

# ==========================================
# 2. 보조 함수들 (약관 목록 및 증권 로드 등)
# ==========================================
def get_all_sections() -> List[str]:
    """toc_config.csv에서 사용 가능한 모든 약관/특약 명칭을 추출합니다."""
    if not os.path.exists(CSV_PATH):
        return []
    sections = []
    with open(CSV_PATH, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = row.get("section_title", "").strip()
            if title:
                sections.append(title)
    return list(set(sections))

def load_policy_md() -> str:
    """개인 보험증권 정보 (tasks/{TASK_NAME}/certificate.md) 파일 내용을 로드합니다."""
    return _load_policy_md(TASK_NAME)

# ==========================================
# 3. Nodes (노드) 정의
# ==========================================

def route_question(state: AgentState) -> Dict[str, Any]:
    """
    [Router Node]
    사용자의 질문과 개인 증권 정보를 기반으로, 약관 조회에 필요한 관련 특약들을 분류합니다.
    """
    print("🔮 [Router Node] 질문 분류 및 연관 특약 분석 중...")
    question = state["question"]
    all_sections = get_all_sections()
    policy_md = load_policy_md()
    
    api_key = os.getenv("OPENAI_API_KEY")
    llm = ChatOpenAI(
        model="gpt-4o-mini", 
        temperature=0, 
        openai_api_key=api_key,
        model_kwargs={"response_format": {"type": "json_object"}}
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """당신은 보험 약관 라우터입니다. 
제공된 [개인 보험증권 정보]와 [사용자 질문]을 비교하여, 질문에 답변하기 위해 반드시 조회해야 하는 관련 약관/특약들의 이름을 후보 목록에서 선택하여 JSON 배열로 반환하세요.

💡 매칭 규칙:
- "식중독, 재해, 깁스, 응급" 등 재해/응급 치료 관련 질문은 '기초응급자금특약', '재해치료비보장특약', '입원특약' 등 관련 특약들을 모두 선택해야 합니다.
- "갑상선암, 제자리암, 경계성종양, 소액암, 양성뇌종양" 등의 진단비(진단보험금)는 반드시 '리빙케어보장특약'을 선택해야 합니다.
- "암, 소액암" 등의 입원/통원 치료비(치료급여금)를 묻는 질문은 '암치료비특약' 또는 '특정질병입원특약'을 선택해야 합니다.
- "수술" 관련 질문은 '특정질병수술보장특약'이나 관련 수술 특약을 선택해야 합니다.
- 일반적인 중대질병(CI) 진단이나 사망에 관한 질문은 주계약이나 'CI두번보장특약', '뉴CI보장특약' 등을 선택해야 합니다.

[개인 보험증권 정보]
{policy_md}

후보 목록:
{sections_list}

응답은 반드시 아래 JSON 형식을 지켜주세요:
{{
  "selected_sections": ["특약명1", "특약명2"]
}}"""),
        ("human", "질문: {question}")
    ])
    
    chain = prompt | llm | JsonOutputParser()
    try:
        response = chain.invoke({
            "policy_md": policy_md,
            "sections_list": json.dumps(all_sections, ensure_ascii=False),
            "question": question
        })
        selected = response.get("selected_sections", [])
        print(f"🎯 라우터 분류 결과: {selected}")
        
        # 실제 존재하는 특약명과 부분 일치 매핑 보정 (공백/언더바 제거 비교)
        matched_filters = []
        for sel in selected:
            sel_cleaned = sel.replace(" ", "").replace("_", "")
            for actual in all_sections:
                actual_cleaned = actual.replace(" ", "").replace("_", "")
                if sel_cleaned in actual_cleaned or actual_cleaned in sel_cleaned:
                    matched_filters.append(actual)
        
        # 만약 매핑된 결과가 없고 selected가 존재한다면 키워드 기반 매핑
        if not matched_filters and selected:
            for sel in selected:
                for actual in all_sections:
                    if any(kw in actual for kw in ["암", "리빙", "수술", "입원", "실손", "재해", "응급", "CI"] if kw in sel):
                        matched_filters.append(actual)
                        
        matched_filters = list(set(matched_filters))
        print(f"🎯 보정된 특약 필터 목록: {matched_filters}")
        return {"section_filters": matched_filters, "loop_count": 0}
    except Exception as e:
        print(f"⚠️ 라우터 오류 발생: {e}. 필터 없이 진행합니다.")
        return {"section_filters": [], "loop_count": 0}


def retrieve(state: AgentState) -> Dict[str, Any]:
    """
    [Retriever Node]
    Supabase(pgvector) documents 테이블에서 이 인물(TASK_NAME)의 문서만 검색합니다.
    Supabase의 match_documents는 메타데이터 컨테인먼트(@>)만 지원해 Chroma의 "$in" 필터를
    그대로 쓸 수 없으므로, task_name으로만 넓게 검색한 뒤 section_title 후보 목록으로
    파이썬 쪽에서 걸러내는 방식으로 동일한 동작을 재현합니다.
    """
    question = state["question"]
    filters = state["section_filters"]
    print(f"🔍 [Retriever Node] 문서 검색 중... (필터링 적용 특약: {filters})")

    try:
        embeddings = get_embeddings()
        vectorstore = get_vectorstore(embeddings)
    except ValueError as e:
        print(f"⚠️ {e}")
        return {"documents": []}

    task_filter = {"task_name": TASK_NAME}
    # 특약 필터가 있으면 후보군을 넉넉히 가져와서(k=20) 파이썬에서 section_title로 걸러냅니다.
    wide_k = 20 if filters else 10

    try:
        candidates = vectorstore.similarity_search(question, k=wide_k, filter=task_filter)

        if filters:
            docs = [d for d in candidates if d.metadata.get("section_title") in filters][:10]
        else:
            docs = candidates[:10]

        # 필터링된 결과가 부족할 경우, 필터를 해제하여 검색 누락 방지
        if len(docs) < 2 and filters:
            print("⚠️ 필터 검색 결과가 부족하여 필터를 해제하고 넓은 범위로 재검색합니다.")
            doc_set = {d.page_content: d for d in docs}
            for d in candidates:
                if d.page_content not in doc_set:
                    docs.append(d)
                    doc_set[d.page_content] = d

        print(f"📦 검색된 총 문서 수: {len(docs)}개")
        return {"documents": docs}
    except Exception as e:
        print(f"⚠️ 문서 검색 중 오류 발생: {e}. 필터 없이 재시도합니다.")
        try:
            docs = vectorstore.similarity_search(question, k=10, filter=task_filter)
            return {"documents": docs}
        except Exception as e2:
            print(f"⚠️ 검색 전체 실패: {e2}")
            return {"documents": []}


def grade_documents(state: AgentState) -> Dict[str, Any]:
    """
    [Document Grader Node]
    검색된 문서들이 사용자 질문에 힌트(지급 비율, 조건, 정의, 용어 등)를 주는지 평가합니다.
    평가 기준을 완화하여 실질적인 단서가 되는 유용한 문서가 제외되지 않도록 합니다.
    """
    print("⚖️ [Document Grader Node] 검색된 문서들의 관련성 평가 중...")
    question = state["question"]
    documents = state["documents"]
    
    if not documents:
        return {"documents": []}
        
    api_key = os.getenv("OPENAI_API_KEY")
    llm = ChatOpenAI(
        model="gpt-4o-mini", 
        temperature=0, 
        openai_api_key=api_key,
        model_kwargs={"response_format": {"type": "json_object"}}
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """당신은 검색된 문서가 사용자의 질문과 연관성이 있는지 평가하는 평가원입니다.
문서 내용이 사용자의 질문에 답하는 데 있어 직접적인 답이 아니더라도, 지급 비율(%), 한도(일수), 가입 조건, 관련 용어의 정의 등
조금이라도 판단의 근거나 힌트가 되는 정보(수치, % 비율 등)를 포함하고 있다면 반드시 "yes"로 평가해야 합니다.
사용자의 질문과 아예 상관없는 엉뚱한 특약의 내용인 경우에만 "no"로 평가하세요.

응답은 반드시 아래 JSON 형식을 지켜주세요:
{{
  "binary_score": "yes" 또는 "no"
}}"""),
        ("human", "문서 내용:\n{document}\n\n사용자 질문: {question}")
    ])
    
    grader_chain = prompt | llm | JsonOutputParser()
    
    filtered_docs = []
    for idx, doc in enumerate(documents, 1):
        try:
            res = grader_chain.invoke({"document": doc.page_content, "question": question})
            score = res.get("binary_score", "no").strip().lower()
            if score == "yes":
                print(f"  [문서 {idx}] 관련성 있음 (유지) - 출처: {doc.metadata.get('section_title', '알 수 없음')}, p.{doc.metadata.get('page', '?')}")
                filtered_docs.append(doc)
            else:
                print(f"  [문서 {idx}] 관련성 없음 (제외) - 출처: {doc.metadata.get('section_title', '알 수 없음')}, p.{doc.metadata.get('page', '?')}")
        except Exception as e:
            print(f"  [문서 {idx}] 평가 오류 ({e}) -> 기본 유지 처리")
            filtered_docs.append(doc)
            
    return {"documents": filtered_docs}


def rewrite_query(state: AgentState) -> Dict[str, Any]:
    """
    [Query Rewrite Node]
    관련성 높은 문서가 부족할 경우, 질문을 더 구체적인 키워드 위주로 재작성하여 검색 성공률을 높집니다.
    """
    print("🔄 [Query Rewrite Node] 관련 문서 부족으로 질문 재작성 중...")
    question = state["question"]
    loop_count = state["loop_count"]
    
    api_key = os.getenv("OPENAI_API_KEY")
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, openai_api_key=api_key)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """당신은 RAG 검색 확률을 높이기 위해 사용자의 질문을 검색에 최적화된 형태로 재작성하는 전문가입니다.
질문의 핵심 의도를 유지하되, 보장 조건, 지급 기준, 가입 금액과 관련된 키워드가 잘 부각되도록 문장 및 키워드를 재구성하세요.
답변은 오직 재작성된 질문 문장만 출력해야 합니다."""),
        ("human", "기존 질문: {question}")
    ])
    
    chain = prompt | llm | StrOutputParser()
    try:
        new_query = chain.invoke({"question": question})
        print(f"🔁 재작성된 질문: '{new_query}' (시도 횟수: {loop_count + 1})")
        return {"question": new_query, "loop_count": loop_count + 1}
    except Exception as e:
        return {"question": question, "loop_count": loop_count + 1}


def generate(state: AgentState) -> Dict[str, Any]:
    """
    [Generate Node]
    개인 증권 정보(Jang.md)와 필터링된 약관 문서를 결합하여, 비율(%)을 실제 보장 금액(원화)으로 환산하여 정확히 답변합니다.
    """
    print("✍️ [Generate Node] 최종 답변 작성 중...")
    question = state["question"]
    documents = state["documents"]
    policy_md = load_policy_md()
    
    api_key = os.getenv("OPENAI_API_KEY")
    llm = ChatOpenAI(model="gpt-4o", temperature=0, openai_api_key=api_key)
    
    # 컨텍스트 조립
    context_text_list = []
    for doc in documents:
        context_text_list.append(
            f"[출처: {doc.metadata.get('section_title', '약관')}, p.{doc.metadata.get('page', '?')}]\n{doc.page_content}"
        )
    context_combined = "\n\n---\n\n".join(context_text_list)
    
    prompt = f"""당신은 보험 약관 및 개인 보험증권 분석 전문 AI 상담원입니다.
아래 제공된 [개인 보험증권 정보]와 [약관 참고 문서]를 대조하여 사용자의 질문에 정확하고 친절하게 답변해 주세요.

⚠️ 답변 작성 규칙:
1. 약관 참고 문서에는 지급 기준이 비율(%)로 나와 있는 경우가 많습니다. 이 경우, [개인 보험증권 정보]에서 해당 특약의 '보험가입금액'을 찾아 실제 지급될 구체적인 보험금 액수(예: 3,000만원의 30% = 900만원)를 직접 계산하여 답변에 명시해 주세요.
2. 각 청구 및 진단 시점에 약관상 면책 기간(예: 가입 후 90일 면책)이나 지급 한도(예: 1회 입원당 120일 한도) 등의 제약 사항이 걸려 있다면, 질문 상황과 비교하여 지급 가능 여부를 팩트체크하여 알려주세요.
3. 정보의 출처(특약명 및 약관 페이지 번호, Jang.md 등)를 반드시 답변에 명시해 주세요.
4. 만약 문서에 질문에 대한 정보가 없다면 억지로 거짓 답변을 지어내지 말고 관련 정보를 찾을 수 없다고 답변하세요.

[개인 보험증권 정보]
{policy_md}

[약관 참고 문서]
{context_combined}

[사용자 질문]
{question}
"""
    
    try:
        response = llm.invoke(prompt)
        return {"generation": response.content}
    except Exception as e:
        print(f"⚠️ 답변 생성 오류: {e}")
        return {"generation": f"오류로 인해 답변을 생성하지 못했습니다: {e}"}

# ==========================================
# 4. Conditional Edges (조건부 분기)
# ==========================================

def decide_to_generate(state: AgentState) -> Literal["generate", "rewrite_query", "fallback_generate"]:
    filtered_documents = state["documents"]
    loop_count = state["loop_count"]
    
    if not filtered_documents:
        if loop_count >= 1:
            print("🚨 [결정] 최대 검색 재시도 횟수를 초과했습니다. 제한적 답변 생성을 시도합니다.")
            return "fallback_generate"
        print("⚠️ [결정] 검색된 문서 중 질문과 관련된 유효 문서가 없습니다. 쿼리를 재작성합니다.")
        return "rewrite_query"
    
    print("🟢 [결정] 유효한 문서가 확보되었습니다. 답변 작성을 시작합니다.")
    return "generate"

def fallback_generate(state: AgentState) -> Dict[str, Any]:
    print("🥀 [Fallback Node] 연관 정보를 찾지 못하여 기본 안내 답변 생성 중...")
    return {"generation": "죄송합니다. 제공해주신 보험 약관에서 해당 질문에 대한 구체적인 지급 기준이나 보장 금액 관련 정보를 찾지 못했습니다. 질문 내용을 조금 더 구체적으로 변경하여 검색해 보시는 것을 권장합니다."}

# ==========================================
# 5. LangGraph 워크플로우 조립
# ==========================================
workflow = StateGraph(AgentState)

# 노드 등록
workflow.add_node("route_question", route_question)
workflow.add_node("retrieve", retrieve)
workflow.add_node("grade_documents", grade_documents)
workflow.add_node("rewrite_query", rewrite_query)
workflow.add_node("generate", generate)
workflow.add_node("fallback_generate", fallback_generate)

# 흐름(엣지) 연결
workflow.add_edge(START, "route_question")
workflow.add_edge("route_question", "retrieve")
workflow.add_edge("retrieve", "grade_documents")

# 그레이딩 결과에 따른 조건부 분기
workflow.add_conditional_edges(
    "grade_documents",
    decide_to_generate,
    {
        "generate": "generate",
        "rewrite_query": "rewrite_query",
        "fallback_generate": "fallback_generate"
    }
)

# 쿼리 재작성 후 다시 리트리브로 루프 연결
workflow.add_edge("rewrite_query", "retrieve")

# 종료 연결
workflow.add_edge("generate", END)
workflow.add_edge("fallback_generate", END)

# 컴파일
app = workflow.compile()


# ==========================================
# 6. 실행 및 테스트부
# ==========================================
def run_agentic_rag(query: str):
    print(f"\n🚀 Agentic RAG 시작! 질문: '{query}'")
    
    inputs = {
        "question": query,
        "section_filters": [],
        "documents": [],
        "generation": "",
        "loop_count": 0
    }
    
    final_state = app.invoke(inputs)
    
    print("\n" + "="*50)
    print("📊 [최종 답변 결과]")
    print("="*50)
    print(final_state["generation"])
    print("="*50)
    
    print("\n🔍 [참조된 최종 문서 목록]")
    for idx, doc in enumerate(final_state["documents"], 1):
        print(f" [{idx}] {doc.metadata.get('section_title', '약관')} (p.{doc.metadata.get('page', '?')})")
        print(f"     내용 요약: {doc.page_content[:150].replace('\n', ' ')}...")
    print("="*50)

if __name__ == "__main__":
    test_queries = [
        "장석찬님이 식중독으로 5일간 입원한 경우 지급받을 수 있는 총 보험금은 얼마인가요?",
        "장석찬님이 보험 가입 후 50일째 되는 날에 위암 확정 진단을 받았습니다. 암 보장을 받을 수 있나요?",
        "암 치료를 목적으로 병원에 150일 동안 장기 입원한 경우, 암입원급여금은 며칠 분까지 지급되나요?",
        "갑상선암이 아닌 초기 갑상선암으로 진단받은 경우 진단비는 얼마인가요?",
        "뇌졸중으로 수술을 받았는데 관혈 수술과 비관혈(내시경) 수술의 보험금 차이가 어떻게 되나요?",
        "약관에서 규정하는 '대장점막내암'의 정의는 무엇인가요?",
        "대장점막내암 진단 시 얼마를 지급받나요?"
    ]
    
    for idx, query in enumerate(test_queries, 1):
        print("\n" + "="*80)
        print(f"📝 [테스트 {idx}] {query}")
        print("="*80)
        run_agentic_rag(query)
