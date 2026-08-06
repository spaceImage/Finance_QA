# [메인 RAG 엔진 - LangGraph Agentic Orchestration Workflow v2.0]
# AGENT.MD 명세를 충실히 이행하는 Agentic RAG 파이프라인
# - Task Planner (GPT-4o mini)
# - Query Validation (GPT-4o mini)
# - Intent Router (GPT-4o mini)
# - Parallel Context Builder (Parallel Fan-out / Fan-in)
# - Multi-hop Reasoning (GPT-5 mini)
# - Response Builder (GPT-5 mini)
# - Model Orchestration Strategy & Workflow Logging 지원

import os
import sys
import json
import csv
import time
import asyncio
import datetime
from typing import List, Dict, Any, Literal, TypedDict, Optional
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser

from langgraph.graph import StateGraph, START, END

from rag_common import get_embeddings, get_vectorstore, load_policy_md as _load_policy_md, get_enrolled_sections
from config import global_model_config
from prompts import (
    TASK_PLANNER_PROMPT,
    QUERY_VALIDATION_PROMPT,
    ROUTER_SYSTEM_PROMPT,
    REASONING_PROMPT,
    MULTIHOP_CHECK_PROMPT,
    GENERATE_BLOCK_SYSTEM_PROMPT,
    OUT_OF_SCOPE_PROMPT,
)

load_dotenv()

# ==========================================
# 1. State 정의 (InsuranceState / AgentState)
# ==========================================
class AgentState(TypedDict):
    question: str
    task_name: str
    tasks_list: List[str]
    is_valid: bool
    invalidation_reason: str
    intent: str
    section_filters: List[str]
    policy_context: str
    documents: List[Document]
    merged_context: str
    reasoning_result: Dict[str, Any]
    generation: str
    loop_count: int
    missing_slots: Optional[List[str]]
    slot_values: Optional[Dict[str, Any]]
    slot_prompt: Optional[str]
    blocks: Optional[List[Dict[str, Any]]]
    node_logs: Optional[List[Dict[str, Any]]]


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

    def _get_llm(self, node_name: str, json_mode: bool = True, temperature: float = 0.0) -> ChatOpenAI:
        model_name = global_model_config.get_model(node_name)
        kwargs = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        return ChatOpenAI(
            model=model_name,
            temperature=temperature,
            openai_api_key=self.openai_api_key,
            model_kwargs=kwargs if kwargs else None,
        )

    def _append_log(self, state: AgentState, node_name: str, start_time: float, info: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        duration_ms = int((time.time() - start_time) * 1000)
        logs = list(state.get("node_logs") or [])
        entry = {
            "node": node_name,
            "duration_ms": duration_ms,
            "timestamp": datetime.datetime.now().isoformat(),
            **(info or {})
        }
        logs.append(entry)
        return logs

    # ==========================================
    # 2. Nodes (노드) 정의
    # ==========================================

    async def task_planner(self, state: AgentState) -> Dict[str, Any]:
        """
        [1. Task Planner Node - GPT-4o mini]
        사용자 질문을 분석하여 세부 작업 순서(seq) 및 워커 수행 모드(RAG_ONLY, RAG_LLM, LLM_ONLY)를 자율적으로 기획합니다.
        """
        t0 = time.time()
        print("\n📋 [Node 1: Task Planner] 질문 자율 오케스트레이션 기획 중...")
        question = state["question"]
        policy_md = self.load_policy_md()

        llm = self._get_llm("planner", json_mode=True)
        prompt = ChatPromptTemplate.from_messages([
            ("system", TASK_PLANNER_PROMPT),
            ("human", "질문: {question}")
        ])
        chain = prompt | llm | JsonOutputParser()

        try:
            res = await chain.ainvoke({"policy_md": policy_md[:1500], "question": question})
            raw_tasks = res.get("tasks", [])
            tasks_list = []
            if isinstance(raw_tasks, list):
                for item in raw_tasks:
                    if isinstance(item, dict):
                        tasks_list.append(item)
                    elif isinstance(item, str):
                        tasks_list.append({
                            "seq": len(tasks_list) + 1,
                            "task_name": item,
                            "worker_mode": "RAG_LLM",
                            "description": "약관 DB 검색 및 LLM 대조"
                        })
            if not tasks_list:
                tasks_list = [
                    {"seq": 1, "task_name": "가입증권 특약 및 보장 한도 조회", "worker_mode": "RAG_ONLY", "description": "증권 MD 유효 특약 확인"},
                    {"seq": 2, "task_name": "약관 보장 대상 및 지급 예외 대조", "worker_mode": "RAG_LLM", "description": "Vector DB 약관 대조"},
                    {"seq": 3, "task_name": "보상 금액 및 면책 정밀 계산", "worker_mode": "LLM_ONLY", "description": "LLM 수학적 계산"}
                ]
            print(f"  └ 자율 기획된 Task 목록 ({len(tasks_list)}개): {[t.get('task_name') for t in tasks_list]}")
            logs = self._append_log(state, "task_planner", t0, {"tasks": tasks_list})
            return {"tasks_list": tasks_list, "policy_context": policy_md, "node_logs": logs}
        except Exception as e:
            print(f"  └ Task Planner 오류: {e}")
            fallback_tasks = [
                {"seq": 1, "task_name": "가입증권 특약 및 보장 한도 조회", "worker_mode": "RAG_ONLY", "description": "증권 MD 유효 특약 확인"},
                {"seq": 2, "task_name": "약관 보장 대상 및 지급 예외 대조", "worker_mode": "RAG_LLM", "description": "Vector DB 약관 대조"},
                {"seq": 3, "task_name": "보상 금액 및 면책 정밀 계산", "worker_mode": "LLM_ONLY", "description": "LLM 수학적 계산"}
            ]
            logs = self._append_log(state, "task_planner", t0, {"tasks": fallback_tasks, "error": str(e)})
            return {"tasks_list": fallback_tasks, "policy_context": policy_md, "node_logs": logs}

    async def query_validation(self, state: AgentState) -> Dict[str, Any]:
        """
        [2. Query Validation Node - GPT-4o mini]
        보험증권 및 약관으로 답변 가능한 질문인지 판단하고, 범위 밖 질문을 사전에 차단합니다.
        """
        t0 = time.time()
        print("🛡️ [Node 2: Query Validation] 처리 가능 범위 검증 중...")
        question = state["question"]

        # 후속 질의 / 짧은 연결 질문인 경우 유효 질의로 자동 통과
        if len(question) < 35 or any(kw in question for kw in ["그럼", "아까", "추가", "포함", "얼마", "사유", "이유", "왜"]):
            print("  └ [Query Validation] 연속 대화/후속 질의 감지 -> 유효 질의 자동 통과 (is_valid=True)")
            logs = self._append_log(state, "query_validation", t0, {"is_valid": True, "reason": "후속 질의 자동 통과"})
            return {"is_valid": True, "invalidation_reason": "", "node_logs": logs}

        llm = self._get_llm("validator", json_mode=True)
        prompt = ChatPromptTemplate.from_messages([
            ("system", QUERY_VALIDATION_PROMPT),
            ("human", "질문: {question}")
        ])
        chain = prompt | llm | JsonOutputParser()
        try:
            policy_md = state.get("policy_context") or self.load_policy_md()
            res = await chain.ainvoke({"policy_md": policy_md[:1500], "question": question})
            is_valid = res.get("is_valid", True)
            reason = res.get("reason", "")
            print(f"  └ 검증 결과: is_valid={is_valid}, 사유='{reason}'")
            logs = self._append_log(state, "query_validation", t0, {"is_valid": is_valid, "reason": reason})
            return {"is_valid": is_valid, "invalidation_reason": reason, "node_logs": logs}
        except Exception as e:
            print(f"  └ Validation 오류: {e}. 기본 진행합니다.")
            logs = self._append_log(state, "query_validation", t0, {"is_valid": True, "error": str(e)})
            return {"is_valid": True, "invalidation_reason": "", "node_logs": logs}

    async def out_of_scope_response(self, state: AgentState) -> Dict[str, Any]:
        """
        [Query Validation 거절 노드]
        범위 밖 질문에 대해 DB 검색을 생략하고 다정한 안내 및 거절 멘트를 작성합니다.
        """
        t0 = time.time()
        print("🚫 [Out-of-Scope Node] 범주 외 질문 안내 멘트 생성...")
        question = state["question"]
        reason = state.get("invalidation_reason") or "현재 시스템은 보험증권 및 약관에 기반한 상담만 지원합니다."

        llm = self._get_llm("validator", json_mode=True)
        prompt = ChatPromptTemplate.from_messages([
            ("system", OUT_OF_SCOPE_PROMPT),
            ("human", "질문: {question}")
        ])
        chain = prompt | llm | JsonOutputParser()

        try:
            res = await chain.ainvoke({"reason": reason, "question": question})
            ans = res.get("answer", reason)
            blocks = res.get("blocks", [])
            logs = self._append_log(state, "out_of_scope_response", t0, {"answer": ans})
            return {"generation": ans, "blocks": blocks, "node_logs": logs}
        except Exception as e:
            msg = f"죄송합니다. 문의하신 내용은 현재 서비스 범위를 벗어나 안내가 어렵습니다. ({reason})"
            blocks = [{"block_type": "CAUTION", "title": "지원 범위 안내", "variant": "warning", "content": reason}]
            logs = self._append_log(state, "out_of_scope_response", t0, {"error": str(e)})
            return {"generation": msg, "blocks": blocks, "node_logs": logs}

    async def intent_router(self, state: AgentState) -> Dict[str, Any]:
        """
        [3. Intent Router Node - GPT-4o mini]
        질문의 주요 의도를 분류하고약관 검색에 필요한 대상 특약들을 선택합니다.
        """
        t0 = time.time()
        print("🔮 [Node 3: Intent Router] 의도 분류 및 연관 특약 매칭 중...")
        question = state["question"]
        all_sections = self.get_all_sections()
        policy_md = state.get("policy_context") or self.load_policy_md()

        llm = self._get_llm("router", json_mode=True)
        prompt = ChatPromptTemplate.from_messages([
            ("system", ROUTER_SYSTEM_PROMPT),
            ("human", "질문: {question}")
        ])
        chain = prompt | llm | JsonOutputParser()

        try:
            response = await chain.ainvoke({
                "policy_md": policy_md,
                "sections_list": json.dumps(all_sections, ensure_ascii=False),
                "question": question
            })

            intent = response.get("intent", "일반_약관_조회")
            is_valid = response.get("is_valid", True)
            missing_info = response.get("missing_info", "")
            selected = response.get("selected_sections", [])
            print(f"  └ Intent: {intent}, selected_sections: {selected}")

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
            print(f"  └ 최종 보정 특약 필터: {matched_filters}")
            logs = self._append_log(state, "intent_router", t0, {"intent": intent, "filters": matched_filters})
            return {
                "intent": intent,
                "section_filters": matched_filters,
                "is_valid": is_valid,
                "invalidation_reason": missing_info,
                "node_logs": logs
            }
        except Exception as e:
            print(f"  └ Intent Router 오류: {e}")
            logs = self._append_log(state, "intent_router", t0, {"error": str(e)})
            return {"intent": "일반_약관_조회", "section_filters": [], "is_valid": True, "node_logs": logs}

    async def check_slots(self, state: AgentState) -> Dict[str, Any]:
        """
        [Check Slots Node]
        보상 계산 시 필수 슬롯(입원일수 등)이 빠져 있는지 체크합니다.
        """
        t0 = time.time()
        print("❓ [Node: Check Slots] 필수 조건 슬롯 유무 점검...")
        question = state["question"]
        slot_values = state.get("slot_values") or {}

        missing_slots = []
        slot_prompt = None

        has_days_in_text = any(kw in question for kw in ["일간", "일동안", "며칠", "일간 입원", "5일", "3일", "7일", "10일", "hospital_days", "보완 정보"])
        if any(kw in question for kw in ["입원", "식중독"]) and "hospital_days" not in slot_values and not has_days_in_text:
            missing_slots.append("hospital_days")
            slot_prompt = "정확한 입원 일수를 알려주시면 보상 금액을 정밀 계산해 드릴 수 있습니다. (예: 5일 입원)"

        logs = self._append_log(state, "check_slots", t0, {"missing_slots": missing_slots})
        if missing_slots and slot_prompt:
            print(f"  └ 필수 슬롯 누락 감지: {missing_slots}")
            return {
                "missing_slots": missing_slots,
                "slot_prompt": slot_prompt,
                "generation": slot_prompt,
                "node_logs": logs
            }

        return {"missing_slots": [], "slot_prompt": None, "node_logs": logs}

    async def ask_slots(self, state: AgentState) -> Dict[str, Any]:
        """
        [Ask Slots Node]
        부족한 슬롯 정보를 되물어 보완받기 위한 대기 답변 생성
        """
        t0 = time.time()
        prompt_text = state.get("slot_prompt") or "보장 계산을 위한 추가 정보를 입력해 주세요."
        blocks = [
            {
                "block_type": "CONTEXT",
                "title": "상황 파악 및 필수 조건 검사",
                "content": f"질문: {state.get('question', '')}"
            },
            {
                "block_type": "CAUTION",
                "title": "추가 정보 보완 필요 (Slot Filling)",
                "variant": "warning",
                "content": prompt_text
            }
        ]
        logs = self._append_log(state, "ask_slots", t0, {"slot_prompt": prompt_text})
        return {"generation": prompt_text, "blocks": blocks, "node_logs": logs}

    async def parallel_context_builder(self, state: AgentState) -> Dict[str, Any]:
        """
        [4. Parallel Context Builder Node - Dynamic Task-driven LLM & RAG Fan-Out]
        Task Planner가 생성한 N개의 도메인 세부 작업(tasks_list) 각각에 대하여
        (1) 작업별 전용 LLM Sub-Query Expander
        (2) 작업별 전용 Vector DB 검색기
        (3) 증권 MD 사전 추출기를 asyncio.gather()로 동적 병렬(Fan-Out) 구동 후 병합(Fan-In)합니다.
        """
        t0 = time.time()
        question = state["question"]
        tasks_list = state.get("tasks_list") or [question]
        filters = state.get("section_filters") or []
        print(f"⚡ [Node 4: Parallel Context Builder] {len(tasks_list)}개 계획 작업별 LLM+RAG 동적 병렬 워커 수행 중... (작업: {tasks_list})")

        # 도메인 세부 작업별 동적 초고속 Vector 검색 워커
        async def run_task_worker(task_item: Any):
            try:
                if isinstance(task_item, dict):
                    t_desc = task_item.get("task_name") or task_item.get("description") or question
                    mode = task_item.get("worker_mode", "RAG_LLM")
                else:
                    t_desc = str(task_item)
                    mode = "RAG_LLM"

                if mode == "LLM_ONLY":
                    return []

                embeddings = get_embeddings()
                vectorstore = get_vectorstore(embeddings)
                task_filter = {"task_name": self.task_name}
                docs = await asyncio.to_thread(
                    vectorstore.similarity_search, t_desc, k=4, filter=task_filter
                )
                return docs
            except Exception as e:
                print(f"⚠️ run_task_worker error: {e}")
                return []

        # 증권 MD 워커
        async def fetch_policy_summary():
            raw_policy = state.get("policy_context") or self.load_policy_md()
            return raw_policy

        # N개 도메인 작업 워커 + 증권 워커 동시 병렬 구동 (Fan-Out)
        worker_coros = [run_task_worker(t) for t in tasks_list]
        worker_coros.append(fetch_policy_summary())

        results = await asyncio.gather(*worker_coros)
        raw_policy = results[-1]
        task_docs_lists = results[:-1]

        # 수집 문서 deduplicate & 병합 (Fan-In)
        doc_set = {}
        for dlist in task_docs_lists:
            for d in dlist:
                key = (d.metadata.get("section_title"), d.metadata.get("page"), d.page_content[:50])
                if key not in doc_set:
                    doc_set[key] = d

        docs = list(doc_set.values())
        if filters:
            filtered = [d for d in docs if d.metadata.get("section_title") in filters]
            if len(filtered) >= 2:
                docs = filtered

        docs = docs[:8]
        print(f"  └ 동적 병렬 수집 완료: {len(tasks_list)}개 워커 실행, 총 {len(docs)}개 약관 문서 통합 완료")

        # Context 병합 (Fan-in)
        context_text_list = []
        for doc in docs:
            context_text_list.append(
                f"[출처: {doc.metadata.get('section_title', '약관')}, p.{doc.metadata.get('page', '?')}]\n{doc.page_content}"
            )
        merged_context = "\n\n---\n\n".join(context_text_list)

        logs = self._append_log(state, "parallel_context_builder", t0, {
            "doc_count": len(docs),
            "tasks_count": len(tasks_list),
            "filters": filters
        })
        return {
            "policy_context": raw_policy,
            "documents": docs,
            "merged_context": merged_context,
            "node_logs": logs
        }

    async def multi_hop_reasoning(self, state: AgentState) -> Dict[str, Any]:
        """
        [5. Multi-hop Reasoning Node - GPT-5 mini]
        연쇄 참조 조항(별표, 제O조 참조 등) 추적 검색 및 손해사정 지급 조건 추론을 수행합니다.
        """
        t0 = time.time()
        print("🧠 [Node 5: Multi-hop Reasoning] 연쇄 참조 조항 검토 및 추론 수행 중...")
        question = state["question"]
        docs = list(state.get("documents") or [])
        policy_md = state.get("policy_context") or ""
        merged_context = state.get("merged_context") or ""

        # 1. Multi-hop 정밀 연쇄 참조 감지 (단순 조항 번호 무차별 매칭 방지)
        import re
        chain_refs = []
        for doc in docs:
            sec_title = doc.metadata.get("section_title", "")
            # 구체적 분류표/특정조항 패턴 (예: "별표 1 [분류표명]", "제X조 (조항명)")
            specific_matches = re.findall(r'(별표\s*\d+(?:\s*[가-힣A-Za-z0-9_]+)?|제\s*\d+\s*조\s*\([^)]+\))', doc.page_content)
            for m in specific_matches:
                clean_m = m.strip()
                # 단순 단독 '제1조', '제2조' 등 범용 조항 번호는 무차별 검색 방지를 위해 스킵
                if re.match(r'^제\s*\d+\s*조$', clean_m):
                    continue
                full_ref = f"{sec_title} {clean_m}".strip()
                if full_ref not in chain_refs and len(full_ref) <= 35:
                    chain_refs.append(full_ref)

        if chain_refs:
            print(f"  └ 🔗 정밀 연쇄 참조 감지 (총 {len(chain_refs)}개 타겟팅): {chain_refs[:3]}")
            try:
                embeddings = get_embeddings()
                vectorstore = get_vectorstore(embeddings)
                task_filter = {"task_name": self.task_name}
                doc_set = {d.page_content: d for d in docs}
                sub_candidates = await asyncio.to_thread(
                    vectorstore.similarity_search, f"{question} {chain_refs[0]}", k=2, filter=task_filter
                )
                for sub_d in sub_candidates:
                    if sub_d.page_content not in doc_set:
                        docs.append(sub_d)
                        doc_set[sub_d.page_content] = sub_d
            except Exception as e:
                print(f"  └ Multi-hop 보충 검색 오류: {e}")

        # 병합 문맥 재구성
        context_text_list = []
        for doc in docs[:6]:
            context_text_list.append(
                f"[출처: {doc.metadata.get('section_title', '약관')}, p.{doc.metadata.get('page', '?')}]\n{doc.page_content}"
            )
        updated_merged_context = "\n\n---\n\n".join(context_text_list)

        # 2. Reasoning 추론 수행
        llm = self._get_llm("reasoning", json_mode=True)
        prompt = ChatPromptTemplate.from_messages([
            ("system", REASONING_PROMPT),
            ("human", "질문: {question}")
        ])
        chain = prompt | llm | JsonOutputParser()

        try:
            reasoning_res = await chain.ainvoke({
                "policy_md": policy_md[:1500],
                "context": updated_merged_context[:2500],
                "question": question
            })
            print(f"  └ 추론 결과 요약: {reasoning_res.get('reasoning_summary', '')[:100]}...")
            logs = self._append_log(state, "multi_hop_reasoning", t0, {
                "chain_refs": chain_refs,
                "is_eligible": reasoning_res.get("is_eligible")
            })
            return {
                "documents": docs,
                "merged_context": updated_merged_context,
                "reasoning_result": reasoning_res,
                "node_logs": logs
            }
        except Exception as e:
            print(f"  └ Reasoning 오류: {e}")
            fallback_res = {"is_eligible": True, "reasoning_summary": updated_merged_context[:300], "estimated_payout": "확인 필요"}
            logs = self._append_log(state, "multi_hop_reasoning", t0, {"error": str(e)})
            return {
                "documents": docs,
                "merged_context": updated_merged_context,
                "reasoning_result": fallback_res,
                "node_logs": logs
            }

    async def grade_documents(self, state: AgentState) -> Dict[str, Any]:
        """
        [Document Grader Node - Context Validator]
        검색된 문서들이 사용자 질문에 대한 답이나 힌트를 포함하는지 평가합니다.
        """
        t0 = time.time()
        print("⚖️ [Node: Document Grader] 검색 문서 관련성 검증...")
        question = state["question"]
        documents = state.get("documents") or []

        if not documents:
            logs = self._append_log(state, "grade_documents", t0, {"kept": 0})
            return {"documents": [], "node_logs": logs}

        llm = self._get_llm("context_validator", json_mode=True)
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
            if isinstance(res, Exception):
                filtered_docs.append(doc)
                continue
            score = res.get("binary_score", "no").strip().lower()
            if score == "yes":
                filtered_docs.append(doc)

        if not filtered_docs:
            print("  └ 관련성 검증: 모든 문서가 필터링되었으나, 추론 진행을 위해 수집 문서를 유지합니다.")
            filtered_docs = documents

        print(f"  └ 관련성 검증 결과: {len(documents)}개 중 {len(filtered_docs)}개 유지")
        logs = self._append_log(state, "grade_documents", t0, {"kept": len(filtered_docs), "total": len(documents)})
        return {"documents": filtered_docs, "node_logs": logs}

    async def rewrite_query(self, state: AgentState) -> Dict[str, Any]:
        """
        [Query Rewrite Node - GPT-4o mini]
        관련 문서 부족 시 검색 키워드를 보강하여 재작성합니다.
        """
        t0 = time.time()
        print("🔄 [Node: Query Rewrite] 관련 문서 부족으로 질문 재작성 중...")
        question = state["question"]
        loop_count = state.get("loop_count", 0)

        llm = self._get_llm("retrieval", json_mode=False)
        prompt = ChatPromptTemplate.from_messages([
            ("system", """당신은 RAG 검색 확률을 높이기 위해 사용자의 질문을 검색에 최적화된 형태로 재작성하는 전문가입니다.
질문의 핵심 의도를 유지하되, 보장 조건, 지급 기준, 가입 금액과 관련된 키워드가 잘 부각되도록 문장 및 키워드를 재구성하세요.
답변은 오직 재작성된 질문 문장만 출력해야 합니다."""),
            ("human", "기존 질문: {question}")
        ])
        chain = prompt | llm | StrOutputParser()

        try:
            new_query = await chain.ainvoke({"question": question})
            print(f"  └ 재작성 질문: '{new_query}' (시도 횟수: {loop_count + 1})")
            logs = self._append_log(state, "rewrite_query", t0, {"new_query": new_query})
            return {"question": new_query, "loop_count": loop_count + 1, "node_logs": logs}
        except Exception as e:
            logs = self._append_log(state, "rewrite_query", t0, {"error": str(e)})
            return {"question": question, "loop_count": loop_count + 1, "node_logs": logs}

    async def generate(self, state: AgentState) -> Dict[str, Any]:
        """
        [6. Response Builder Node - GPT-5 mini]
        추론 결과와 약관 문서, 개인 증권을 결합하여 최종 상담사 답변 및 UI Block JSON을 생성합니다.
        """
        t0 = time.time()
        print("✍️ [Node 6: Response Builder] 최종 답변 및 UI Block 생성 중...")
        question = state["question"]
        documents = state.get("documents") or []
        policy_md = state.get("policy_context") or self.load_policy_md()
        reasoning_res = state.get("reasoning_result") or {}
        reasoning_summary = json.dumps(reasoning_res, ensure_ascii=False)

        llm = self._get_llm("response", json_mode=True)

        context_text_list = []
        for doc in documents:
            context_text_list.append(
                f"[출처: {doc.metadata.get('section_title', '약관')}, p.{doc.metadata.get('page', '?')}]\n{doc.page_content}"
            )
        context_combined = "\n\n---\n\n".join(context_text_list)

        prompt = GENERATE_BLOCK_SYSTEM_PROMPT.format(
            policy_md=policy_md,
            reasoning_summary=reasoning_summary,
            context=context_combined
        ) + f"\n\n[사용자 질문]\n{question}"

        try:
            res = await llm.ainvoke(prompt)
            parsed = json.loads(res.content)
            answer = parsed.get("answer", "")
            blocks = parsed.get("blocks", [])

            # answer에 상담 유의사항(CAUTION) 및 고객 전달 가이드(DELIVER) 항목이 통일된 Markdown으로 결합되도록 합성
            cautions = [b.get("content") for b in blocks if b.get("block_type") == "CAUTION" and b.get("content")]
            delivers = [b.get("content") for b in blocks if b.get("block_type") == "DELIVER" and b.get("content")]

            full_parts = [answer]
            if cautions and not any("유의사항" in answer for _ in [1]):
                full_parts.append("\n\n> ⚠️ **상담 시 유의사항**\n> " + "\n> ".join(cautions))
            if delivers and not any("고객 전달" in answer for _ in [1]):
                full_parts.append("\n\n> ✅ **고객 전달 가이드**\n> " + "\n> ".join(delivers))

            final_answer_md = "".join(full_parts)
            print(f"  └ Response Builder 완료. Answer MD 길이: {len(final_answer_md)}, Blocks 수: {len(blocks)}")
            logs = self._append_log(state, "generate", t0, {"block_count": len(blocks)})
            return {"generation": final_answer_md, "blocks": blocks, "node_logs": logs}
        except Exception as e:
            print(f"  └ Response Builder 오류: {e}")
            fallback_msg = "약관 대조 중 오류가 발생하여 기본 안내를 출력합니다."
            logs = self._append_log(state, "generate", t0, {"error": str(e)})
            return {"generation": fallback_msg, "blocks": [], "node_logs": logs}

    async def fallback_generate(self, state: AgentState) -> Dict[str, Any]:
        t0 = time.time()
        print("🥀 [Fallback Node] 연관 약관 미발견 안내 생성...")
        message = "죄송합니다. 제공해주신 보험 약관에서 해당 질문에 대한 구체적인 지급 기준이나 보장 금액 관련 정보를 찾지 못했습니다. 질문 내용을 조금 더 구체적으로 변경하여 검색해 보시는 것을 권장합니다."
        blocks = [
            {
                "block_type": "CAUTION",
                "title": "약관 정보 검색 결과 안내",
                "variant": "warning",
                "content": message
            }
        ]
        logs = self._append_log(state, "fallback_generate", t0, {"message": message})
        return {"generation": message, "blocks": blocks, "node_logs": logs}

    # ==========================================
    # 3. Graph Edges / Conditional Logic
    # ==========================================

    def decide_query_validity(self, state: AgentState) -> Literal["intent_router", "out_of_scope_response"]:
        if state.get("is_valid") is False:
            return "out_of_scope_response"
        return "intent_router"

    def decide_to_ask_slots(self, state: AgentState) -> Literal["ask_slots", "parallel_context_builder"]:
        if state.get("missing_slots"):
            return "ask_slots"
        return "parallel_context_builder"

    def decide_to_generate(self, state: AgentState) -> Literal["multi_hop_reasoning", "rewrite_query", "fallback_generate"]:
        filtered_documents = state.get("documents") or []
        loop_count = state.get("loop_count", 0)

        if not filtered_documents:
            if loop_count >= 1:
                return "fallback_generate"
            return "rewrite_query"

        return "multi_hop_reasoning"

    def decide_after_reasoning(self, state: AgentState) -> Literal["parallel_context_builder", "generate"]:
        """
        [Multi-hop Reflection Loop Edge]
        추론 중 미수집된 연쇄 참조 조항(별표 X, 제O조 등)이 발견되면 Parallel Context Builder로 루프백하여 보충 수집합니다.
        """
        reasoning_res = state.get("reasoning_result") or {}
        chain_refs = reasoning_res.get("chain_refs") or []
        loop_count = state.get("loop_count", 0)

        if chain_refs and loop_count < 1:
            print(f"🔄 [Multi-hop Reflection Loop] 연쇄 참조 조항({len(chain_refs)}개) 발견으로 Context Builder 재진입 (Loop #{loop_count + 1})")
            return "parallel_context_builder"
        return "generate"

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(AgentState)

        # Nodes 등록
        workflow.add_node("task_planner", self.task_planner)
        workflow.add_node("query_validation", self.query_validation)
        workflow.add_node("out_of_scope_response", self.out_of_scope_response)
        workflow.add_node("intent_router", self.intent_router)
        workflow.add_node("check_slots", self.check_slots)
        workflow.add_node("ask_slots", self.ask_slots)
        workflow.add_node("parallel_context_builder", self.parallel_context_builder)
        workflow.add_node("grade_documents", self.grade_documents)
        workflow.add_node("multi_hop_reasoning", self.multi_hop_reasoning)
        workflow.add_node("rewrite_query", self.rewrite_query)
        workflow.add_node("generate", self.generate)
        workflow.add_node("fallback_generate", self.fallback_generate)

        # Edges 구성 (1단계 범위 검증 -> 2단계 자율 작업 기획 -> 3단계 의도 라우팅)
        workflow.add_edge(START, "query_validation")

        workflow.add_conditional_edges(
            "query_validation",
            self.decide_query_validity,
            {
                "intent_router": "task_planner",
                "out_of_scope_response": "out_of_scope_response"
            }
        )

        workflow.add_edge("task_planner", "intent_router")

        workflow.add_edge("out_of_scope_response", END)
        workflow.add_edge("intent_router", "check_slots")

        workflow.add_conditional_edges(
            "check_slots",
            self.decide_to_ask_slots,
            {
                "ask_slots": "ask_slots",
                "parallel_context_builder": "parallel_context_builder"
            }
        )

        workflow.add_edge("ask_slots", END)
        workflow.add_edge("parallel_context_builder", "grade_documents")

        workflow.add_conditional_edges(
            "grade_documents",
            self.decide_to_generate,
            {
                "multi_hop_reasoning": "multi_hop_reasoning",
                "rewrite_query": "rewrite_query",
                "fallback_generate": "fallback_generate"
            }
        )

        workflow.add_edge("rewrite_query", "parallel_context_builder")

        # Multi-hop Reflection Loop Edge
        workflow.add_conditional_edges(
            "multi_hop_reasoning",
            self.decide_after_reasoning,
            {
                "parallel_context_builder": "parallel_context_builder",
                "generate": "generate"
            }
        )

        workflow.add_edge("generate", END)
        workflow.add_edge("fallback_generate", END)

        return workflow.compile()

    async def ainvoke(self, query: str, slot_values: Optional[dict] = None) -> Dict[str, Any]:
        inputs = {
            "question": query,
            "task_name": self.task_name,
            "tasks_list": [],
            "is_valid": True,
            "invalidation_reason": "",
            "intent": "",
            "section_filters": [],
            "policy_context": "",
            "documents": [],
            "merged_context": "",
            "reasoning_result": {},
            "generation": "",
            "loop_count": 0,
            "missing_slots": [],
            "slot_values": slot_values or {},
            "slot_prompt": None,
            "node_logs": []
        }
        return await self.app.ainvoke(inputs)

    async def astream_nodes(self, query: str, slot_values: Optional[dict] = None):
        """
        [Real-time Node Event Stream]
        LangGraph 노드가 하나씩 완료될 때마다 실시간으로 노드 결과를 생성합니다.
        """
        inputs = {
            "question": query,
            "task_name": self.task_name,
            "tasks_list": [],
            "is_valid": True,
            "invalidation_reason": "",
            "intent": "",
            "section_filters": [],
            "policy_context": "",
            "documents": [],
            "merged_context": "",
            "reasoning_result": {},
            "generation": "",
            "loop_count": 0,
            "missing_slots": [],
            "slot_values": slot_values or {},
            "slot_prompt": None,
            "blocks": [],
            "node_logs": []
        }
        async for event in self.app.astream(inputs):
            yield event

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
                    return pool.submit(lambda: asyncio.run(self.ainvoke(query, slot_values))).result()
            else:
                return loop.run_until_complete(self.ainvoke(query, slot_values))


def run_agentic_rag(query: str, task_name: str = "jang") -> Dict[str, Any]:
    engine = InsuranceRAGEngine(task_name=task_name)
    return engine.invoke(query)


def run_agentic_rag_json(query: str, task_name: str = "jang", slot_values: Optional[dict] = None) -> str:
    engine = InsuranceRAGEngine(task_name=task_name)
    state = engine.invoke(query, slot_values=slot_values)

    docs = state.get("documents") or []
    referenced_pages = []
    for d in docs:
        sec = d.metadata.get("section_title", "약관")
        pg = d.metadata.get("page", "?")
        referenced_pages.append(f"{sec} (p.{pg})")

    response_data = {
        "status": "OUT_OF_SCOPE" if state.get("is_valid") is False else "SUCCESS",
        "answer": state.get("generation", ""),
        "blocks": state.get("blocks", []),
        "total_referenced_count": len(docs),
        "referenced_pages": list(set(referenced_pages)),
        "tasks": state.get("tasks_list", []),
        "intent": state.get("intent", ""),
        "node_logs": state.get("node_logs", [])
    }
    return json.dumps(response_data, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    test_query = "재해골절 시 얼마 나오나요?"
    if len(sys.argv) > 1:
        test_query = sys.argv[1]
    print(f"🚀 [테스트 실행] 질문: {test_query}")
    res_json = run_agentic_rag_json(test_query)
    print("\n[최종 JSON 결과]")
    print(res_json)
