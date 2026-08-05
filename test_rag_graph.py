# [메인 RAG 엔진 - LangGraph 에이전트형] 질문 -> 관련 특약 자동 분류(라우팅) -> 검색 ->
# 검색결과 관련성 평가(병렬) -> (부족하면) 질문 재작성 후 재검색 -> 최종 답변, 순서로 동작하는
# 멀티스텝 RAG. 이 프로젝트의 실제 질의응답을 담당하는 파일입니다.
# - 터미널 확인용: run_agentic_rag(query)
# - API/화면 연동용: run_agentic_rag_json(query) -> JSON 문자열 반환
import os
import sys
import json
import csv
import asyncio
from typing import List, Dict, Any, Literal, TypedDict, Optional
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser

from langgraph.graph import StateGraph, START, END

from rag_common import get_embeddings, get_vectorstore, load_policy_md as _load_policy_md, get_enrolled_sections

# .env 파일 로드
load_dotenv()

# ==========================================
# 1. State 정의
# ==========================================
class AgentState(TypedDict):
    question: str
    section_filters: List[str]
    documents: List[Document]
    generation: str
    loop_count: int
    missing_slots: List[str]
    slot_values: Dict[str, Any]
    slot_prompt: Optional[str]


class InsuranceRAGEngine:
    def __init__(self, task_name: str = "jang", openai_api_key: Optional[str] = None):
        self.task_name = task_name
        self.csv_path = f"tasks/{task_name}/inputs/toc_config.csv"
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        self.app = self._build_graph()

    def get_all_sections(self) -> List[str]:
        """toc_config.csv에서 사용 가능한 특약 명칭을 추출합니다."""
        if not os.path.exists(self.csv_path):
            return []
        sections = []
        with open(self.csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                title = row.get("section_title", "").strip()
                if title:
                    sections.append(title)
        all_sections = list(set(sections))

        enrolled = get_enrolled_sections(self.task_name)
        if enrolled:
            allowed = set(enrolled)
            return [s for s in all_sections if s in allowed]
        return all_sections

    def load_policy_md(self) -> str:
        """개인 보험증권 정보 파일을 로드합니다."""
        return _load_policy_md(self.task_name)

    # ==========================================
    # 3. Nodes (노드) 정의
    # ==========================================

    async def route_question(self, state: AgentState) -> Dict[str, Any]:
        """
        [Router Node]
        사용자의 질문과 개인 증권 정보를 기반으로, 약관 조회에 필요한 관련 특약들을 분류합니다.
        """
        print("🔮 [Router Node] 질문 분류 및 연관 특약 분석 중...")
        question = state["question"]
        all_sections = self.get_all_sections()
        policy_md = self.load_policy_md()
        
        llm = ChatOpenAI(
            model="gpt-4o-mini", 
            temperature=0, 
            openai_api_key=self.openai_api_key,
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
            response = await chain.ainvoke({
                "policy_md": policy_md,
                "sections_list": json.dumps(all_sections, ensure_ascii=False),
                "question": question
            })
            selected = response.get("selected_sections", [])
            print(f"🎯 라우터 분류 결과: {selected}")
            
            matched_filters = []
            for sel in selected:
                sel_cleaned = sel.replace(" ", "").replace("_", "")
                for actual in all_sections:
                    actual_cleaned = actual.replace(" ", "").replace("_", "")
                    if sel_cleaned in actual_cleaned or actual_cleaned in sel_cleaned:
                        matched_filters.append(actual)
            
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

    async def retrieve(self, state: AgentState) -> Dict[str, Any]:
        """
        [Retriever Node]
        Supabase(pgvector) documents 테이블에서 이 인물의 문서만 검색합니다.
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

        task_filter = {"task_name": self.task_name}
        wide_k = 20 if filters else 10

        try:
            candidates = await asyncio.to_thread(
                vectorstore.similarity_search, question, k=wide_k, filter=task_filter
            )

            if filters:
                docs = [d for d in candidates if d.metadata.get("section_title") in filters][:10]
            else:
                docs = candidates[:10]

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
                docs = await asyncio.to_thread(
                    vectorstore.similarity_search, question, k=10, filter=task_filter
                )
                return {"documents": docs}
            except Exception as e2:
                print(f"⚠️ 검색 전체 실패: {e2}")
                return {"documents": []}

    async def grade_documents(self, state: AgentState) -> Dict[str, Any]:
        """
        [Document Grader Node]
        검색된 문서들이 사용자 질문에 힌트를 주는지 평가합니다.
        """
        print("⚖️ [Document Grader Node] 검색된 문서들의 관련성 평가 중...")
        question = state["question"]
        documents = state["documents"]
        
        if not documents:
            return {"documents": []}
            
        llm = ChatOpenAI(
            model="gpt-4o-mini", 
            temperature=0, 
            openai_api_key=self.openai_api_key,
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

        batch_inputs = [{"document": doc.page_content, "question": question} for doc in documents]
        results = await grader_chain.abatch(batch_inputs, config={"max_concurrency": 6}, return_exceptions=True)

        filtered_docs = []
        for idx, (doc, res) in enumerate(zip(documents, results), 1):
            title = doc.metadata.get('section_title', '알 수 없음')
            page = doc.metadata.get('page', '?')
            if isinstance(res, Exception):
                print(f"  [문서 {idx}] 평가 오류 ({res}) -> 기본 유지 처리")
                filtered_docs.append(doc)
                continue
            score = res.get("binary_score", "no").strip().lower()
            if score == "yes":
                print(f"  [문서 {idx}] 관련성 있음 (유지) - 출처: {title}, p.{page}")
                filtered_docs.append(doc)
            else:
                print(f"  [문서 {idx}] 관련성 없음 (제외) - 출처: {title}, p.{page}")

        return {"documents": filtered_docs}

    async def rewrite_query(self, state: AgentState) -> Dict[str, Any]:
        """
        [Query Rewrite Node]
        관련성 높은 문서가 부족할 경우, 질문을 더 구체적인 키워드 위주로 재작성하여 검색 성공률을 높입니다.
        """
        print("🔄 [Query Rewrite Node] 관련 문서 부족으로 질문 재작성 중...")
        question = state["question"]
        loop_count = state["loop_count"]
        
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, openai_api_key=self.openai_api_key)
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", """당신은 RAG 검색 확률을 높이기 위해 사용자의 질문을 검색에 최적화된 형태로 재작성하는 전문가입니다.
질문의 핵심 의도를 유지하되, 보장 조건, 지급 기준, 가입 금액과 관련된 키워드가 잘 부각되도록 문장 및 키워드를 재구성하세요.
답변은 오직 재작성된 질문 문장만 출력해야 합니다."""),
            ("human", "기존 질문: {question}")
        ])
        
        chain = prompt | llm | StrOutputParser()
        try:
            new_query = await chain.ainvoke({"question": question})
            print(f"🔁 재작성된 질문: '{new_query}' (시도 횟수: {loop_count + 1})")
            return {"question": new_query, "loop_count": loop_count + 1}
        except Exception as e:
            return {"question": question, "loop_count": loop_count + 1}

    async def generate(self, state: AgentState) -> Dict[str, Any]:
        """
        [Generate Node]
        개인 증권 정보와 필터링된 약관 문서를 결합하여 구체적인 보험금 액수를 직접 계산하여 답변합니다.
        """
        print("✍️ [Generate Node] 최종 답변 작성 중...")
        question = state["question"]
        documents = state["documents"]
        policy_md = self.load_policy_md()
        
        llm = ChatOpenAI(model="gpt-4o", temperature=0, openai_api_key=self.openai_api_key)
        
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
   단, 계산에 쓰는 비율(%)이나 공제금액은 반드시 **지금 답변하려는 그 항목의 조항에 실제로 적힌 숫자**여야 합니다.
   "실손보험은 보통 급여 90%를 보상한다"처럼 일반적인 보험 상식이나 다른 조항(예: 입원형)에서 본 숫자를
   가져와 적용하지 마세요 — 해당 조항에 비율이 없으면(예: 공제금액만 빼고 한도까지 보상) 비율 없이 그대로 계산하세요.
2. 각 청구 및 진단 시점에 약관상 면책 기간(예: 가입 후 90일 면책)이나 지급 한도(예: 1회 입원당 120일 한도) 등의 제약 사항이 걸려 있다면, 질문 상황과 비교하여 지급 가능 여부를 팩트체크하여 알려주세요.
3. 정보의 출처(특약명 및 약관 페이지 번호, 개인 보험증권 등)를 반드시 답변에 명시해 주세요.
4. [개인 보험증권 정보]는 이 고객이 가입한 특약의 '전체' 목록입니다(빠짐없이 다 나와 있음). 질문한 보장 항목이
   이 목록의 어떤 특약과도 관련이 없다면, "확인이 필요합니다"처럼 얼버무리지 말고
   "가입하신 보장 항목에는 OOO가 포함되어 있지 않아, 이 건으로는 보험금을 받으실 수 없습니다."처럼
   가입하지 않았다는 사실 자체를 근거로 확정적으로 답변하세요. (단, [약관 참고 문서]에서 관련 조항이 실제로
   검색되었는데 세부 지급조건만 불분명한 경우에는 그 조항을 근거로 답변하고, 이 규칙을 적용하지 마세요.)
5. 추상적이거나 '보험사에 문의하세요', '약관을 직접 확인해 보세요' 같이 사용자를 다른 곳으로 떠넘기는
   원론적인 답변은 절대 금지합니다. 판단은 항상 당신이 직접 내려서 답변하세요.
6. 약관 원문에 직접 적히지 않은 가상의 임의 예시 숫자(예: '1,000만원 발생 시 900만원 보상된다' 등)는 지어내지 마세요.
7. 답변은 반드시 한국어로 작성하고, 문장 끝에 마침표를 붙여 완결된 문장으로 작성하세요.

[개인 보험증권 정보]
{policy_md}

[약관 참고 문서]
{context_combined}

[사용자 질문]
{question}
"""
        
        try:
            print("\n" + "="*50)
            print("📊 [최종 답변 결과]")
            print("="*50)
            full_text = ""
            async for chunk in llm.astream(prompt):
                piece = chunk.content or ""
                print(piece, end="", flush=True)
                full_text += piece
            print("\n" + "="*50)
            return {"generation": full_text}
        except Exception as e:
            print(f"⚠️ 답변 생성 오류: {e}")
            return {"generation": f"오류로 인해 답변을 생성하지 못했습니다: {e}"}

    async def check_slots(self, state: AgentState) -> Dict[str, Any]:
        """
        [Check Slots Node]
        질문에서 보상 계산 필수 정보(입원일수, 수술방식, 암병기 등)가 빠져 있는지 점검합니다.
        """
        print("❓ [Check Slots Node] 필수 슬롯(보상 조건) 유무 검사 중...")
        question = state["question"]
        slot_values = state.get("slot_values") or {}

        missing_slots = []
        slot_prompt = None

        # 1. 입원 관련 필수 슬롯 체크
        has_days_in_text = any(kw in question for kw in ["일간", "일동안", "며칠", "일간 입원", "5일", "3일", "7일", "hospital_days", "보완 정보"])
        if any(kw in question for kw in ["입원", "식중독"]) and "hospital_days" not in slot_values and not has_days_in_text:
            missing_slots.append("hospital_days")
            slot_prompt = "피보험자님, 정확한 입원 일수를 알려주시면 보상 금액을 정밀 계산해 드릴 수 있습니다. (예: 5일 입원)"

        if missing_slots and slot_prompt:
            print(f"⚠️ 필수 슬롯 누락 감지: {missing_slots} -> 되묻기 발동!")
            return {
                "missing_slots": missing_slots,
                "slot_prompt": slot_prompt,
                "generation": slot_prompt
            }

        print("🟢 필수 슬롯 검사 통과. 약관 검색으로 진행합니다.")
        return {"missing_slots": [], "slot_prompt": None}

    async def ask_slots(self, state: AgentState) -> Dict[str, Any]:
        """
        [Ask Slots Node]
        사용자에게 부족한 슬롯 정보를 되물어 보완받기 위한 대기 답변 생성
        """
        prompt_text = state.get("slot_prompt") or "보목 계산을 위한 추가 정보를 입력해 주세요."
        print("\n" + "="*50)
        print("❓ [AI 되묻기 (Slot Filling)]")
        print("="*50)
        print(prompt_text)
        print("="*50)
        return {"generation": prompt_text}

    def decide_to_ask_slots(self, state: AgentState) -> Literal["ask_slots", "retrieve"]:
        if state.get("missing_slots"):
            return "ask_slots"
        return "retrieve"

    def decide_to_generate(self, state: AgentState) -> Literal["generate", "rewrite_query", "fallback_generate"]:
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

    async def fallback_generate(self, state: AgentState) -> Dict[str, Any]:
        print("🥀 [Fallback Node] 연관 정보를 찾지 못하여 기본 안내 답변 생성 중...")
        message = "죄송합니다. 제공해주신 보험 약관에서 해당 질문에 대한 구체적인 지급 기준이나 보장 금액 관련 정보를 찾지 못했습니다. 질문 내용을 조금 더 구체적으로 변경하여 검색해 보시는 것을 권장합니다."
        print("\n" + "="*50)
        print("📊 [최종 답변 결과]")
        print("="*50)
        print(message)
        print("="*50)
        return {"generation": message}

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(AgentState)
        
        workflow.add_node("route_question", self.route_question)
        workflow.add_node("check_slots", self.check_slots)
        workflow.add_node("ask_slots", self.ask_slots)
        workflow.add_node("retrieve", self.retrieve)
        workflow.add_node("grade_documents", self.grade_documents)
        workflow.add_node("rewrite_query", self.rewrite_query)
        workflow.add_node("generate", self.generate)
        workflow.add_node("fallback_generate", self.fallback_generate)
        
        workflow.add_edge(START, "route_question")
        workflow.add_edge("route_question", "check_slots")
        
        workflow.add_conditional_edges(
            "check_slots",
            self.decide_to_ask_slots,
            {
                "ask_slots": "ask_slots",
                "retrieve": "retrieve"
            }
        )
        
        workflow.add_edge("retrieve", "grade_documents")
        
        workflow.add_conditional_edges(
            "grade_documents",
            self.decide_to_generate,
            {
                "generate": "generate",
                "rewrite_query": "rewrite_query",
                "fallback_generate": "fallback_generate"
            }
        )
        
        workflow.add_edge("rewrite_query", "retrieve")
        workflow.add_edge("ask_slots", END)
        workflow.add_edge("generate", END)
        workflow.add_edge("fallback_generate", END)
        
        return workflow.compile()

    async def ainvoke(self, query: str, slot_values: Optional[dict] = None) -> Dict[str, Any]:
        inputs = {
            "question": query,
            "section_filters": [],
            "documents": [],
            "generation": "",
            "loop_count": 0,
            "missing_slots": [],
            "slot_values": slot_values or {},
            "slot_prompt": None
        }
        return await self.app.ainvoke(inputs)

    def invoke(self, query: str, slot_values: Optional[dict] = None) -> Dict[str, Any]:
        """
        [Sync Invoke]
        동기적으로 그래프를 실행합니다.
        """
        try:
            return asyncio.run(self.ainvoke(query, slot_values))
        except RuntimeError:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    return pool.submit(lambda: asyncio.run(self.ainvoke(query))).result()
            else:
                return loop.run_until_complete(self.ainvoke(query))

    async def astream_rag(self, query: str):
        """
        [Async Generator]
        LangGraph의 astream_events를 사용하여 실시간 노드 상태 및 LLM 토큰 이벤트를 제너레이터로 양방향/SSE/WebSocket 등에 매핑하기 쉽게 출력합니다.
        """
        inputs = {
            "question": query,
            "section_filters": [],
            "documents": [],
            "generation": "",
            "loop_count": 0
        }
        
        async for event in self.app.astream_events(inputs, version="v2"):
            kind = event["event"]
            
            # 1. 노드 시작/종료 감지
            if kind == "on_chain_start" and "langgraph_node" in event["metadata"]:
                node_name = event["metadata"]["langgraph_node"]
                yield {
                    "event": "node_start",
                    "node": node_name,
                    "data": None
                }
            elif kind == "on_chain_end" and "langgraph_node" in event["metadata"]:
                node_name = event["metadata"]["langgraph_node"]
                output_state = event["data"].get("output") if event.get("data") else None
                if isinstance(output_state, dict):
                    node_data = {
                        "question": output_state.get("question"),
                        "section_filters": output_state.get("section_filters"),
                        "loop_count": output_state.get("loop_count")
                    }
                else:
                    node_data = {"output": output_state}
                yield {
                    "event": "node_end",
                    "node": node_name,
                    "data": node_data
                }
                
            # 2. LLM 생성 토큰 감지
            elif kind == "on_chat_model_stream":
                node_name = event["metadata"].get("langgraph_node")
                if node_name in ["generate", "fallback_generate"]:
                    chunk = event["data"].get("chunk")
                    if chunk and chunk.content:
                        yield {
                            "event": "token",
                            "node": node_name,
                            "data": chunk.content
                        }


# ==========================================
# 6. 하위 호환성용 전역 호출 함수 및 CLI 모드
# ==========================================

def run_agentic_rag(query: str, task_name: str = "jang"):
    """[터미널용] 기존 run_agentic_rag 함수와의 하드코딩 호환성을 보장합니다."""
    print(f"\n🚀 Agentic RAG 시작! 질문: '{query}'")
    engine = InsuranceRAGEngine(task_name=task_name)
    final_state = engine.invoke(query)

    print("\n🔍 [참조된 최종 문서 목록]")
    for idx, doc in enumerate(final_state["documents"], 1):
        print(f" [{idx}] {doc.metadata.get('section_title', '약관')} (p.{doc.metadata.get('page', '?')})")
        clean_text = doc.page_content[:150].replace("\n", " ")
        print(f"     내용 요약: {clean_text}...")
    print("="*50)


def run_agentic_rag_json(query: str, task_name: str = "jang", slot_values: Optional[dict] = None) -> str:
    """[API/화면용] 기존 run_agentic_rag_json 함수와의 호환성을 보장합니다."""
    engine = InsuranceRAGEngine(task_name=task_name)
    final_state = engine.invoke(query, slot_values=slot_values)

    referenced_pages = [
        {
            "section_title": doc.metadata.get("section_title"),
            "page_number": doc.metadata.get("page"),
            "source_pdf": doc.metadata.get("source_pdf"),
            "full_content": doc.page_content,
        }
        for doc in final_state.get("documents", [])
    ]

    output_data = {
        "query": query,
        "answer": final_state.get("generation", ""),
        "total_referenced_count": len(referenced_pages),
        "referenced_pages": referenced_pages,
    }
    return json.dumps(output_data, ensure_ascii=False, indent=2)


DEMO_QUERIES = [
    "장석찬님이 식중독으로 5일간 입원한 경우 지급받을 수 있는 총 보험금은 얼마인가요?",
    "장석찬님이 보험 가입 후 50일째 되는 날에 위암 확정 진단을 받았습니다. 암 보장을 받을 수 있나요?",
    "암 치료를 목적으로 병원에 150일 동안 장기 입원한 경우, 암입원급여금은 며칠 분까지 지급되나요?",
    "갑상선암이 아닌 초기 갑상선암으로 진단받은 경우 진단비는 얼마인가요?",
    "뇌졸중으로 수술을 받았는데 관혈 수술과 비관혈(내시경) 수술의 보험금 차이가 어떻게 되나요?",
    "약관에서 규정하는 '대장점막내암'의 정의는 무엇인가요?",
    "대장점막내암 진단 시 얼마를 지급받나요?"
]

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--demo":
            for idx, query in enumerate(DEMO_QUERIES, 1):
                print("\n" + "="*80)
                print(f"📝 [테스트 {idx}] {query}")
                print("="*80)
                run_agentic_rag(query)
        else:
            run_agentic_rag(" ".join(sys.argv[1:]))
    else:
        try:
            while True:
                user_query = input("\n💬 질문을 입력하세요 (종료하려면 'exit' 또는 'q' 입력): ").strip()
                if not user_query:
                    continue
                if user_query.lower() in ["exit", "q", "종료"]:
                    print("👋 프로그램을 종료합니다.")
                    break
                run_agentic_rag(user_query)
        except KeyboardInterrupt:
            print("\n👋 프로그램을 종료합니다.")
