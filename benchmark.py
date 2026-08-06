# [벤치마크/검증용] 미리 정해둔 검증 질문들을 test_rag_graph.py의 Agentic RAG로 실행하고,
# 답변이 실제 검색된 근거 문서에 기반했는지(hallucination 없는지) LLM-judge로 이중 검증한 뒤,
# PASS/FAIL, 근거검증 결과, 소요시간을 benchmark_results.json으로 저장합니다.
import time
import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

from test_rag_graph import InsuranceRAGEngine
from rag_common import load_policy_md

TASK_NAME = "jang"

# 장석찬님 실제 약관/증권 기준 단일 및 Multi-hop 복합 검증 질문 목록
QUESTIONS = [
    "갑상선암으로 진단받았을 때 보장 금액은?",
    "뇌졸중으로 수술 시 수술보험금은?",
    "상해로 뼈가 부러지는 재해골절 시 얼마?",
    "암 치료 목적 10일 입원 시 입원비는?",
    "대장점막내암이나 제자리암 진단 시 얼마?",
    "첫 번째 CI 진단 후 1년 생존 시 추가 보험금?",
    "식중독 입원 및 응급실 통원 시 보장 여부?",
    "재해로 인해 얼굴 흉터(추상) 남으면 얼마?",
    "교통사고 재해로 50% 장해지급률 시 얼마?",
    "실손 특약으로 통원 치료 시 하루 최대 한도?",
    # ⭐ [Multi-hop 고난도 복합 평가 질의 5종]
    "장석찬님이 대장점막내암 진단 후 10일간 입원 치료를 받은 경우, 리빙케어 특약과 특정질병입원특약에서 각각 얼마 보상받나요?",
    "식중독으로 5일 입원 치료 중 수액 10만원 치료를 동시에 받은 경우, 실손의료비와 특정질병입원특약 중복 보상은?",
    "초기 갑상선암 수술을 받은 후 1년 뒤 일반 갑상선암으로 재발한 경우 리빙케어특약 차등 지급금 계산은?",
    "재해로 인한 골절로 통원 치료 3회 및 입원 7일을 한 경우 보상받을 수 있는 총 항목과 한도는?",
    "CI 종신보험 보장형 계약에서 중대한 질병 진단 시 주계약 사망보험금과 리빙케어 특약 간의 선지급 관계는?"
]


def grounding_check(answer: str, documents, policy_md: str) -> tuple[bool, str]:
    """생성된 답변이 실제로 검색된 근거 문서(+ 개인 보험증권 + 상식적인 비율/일당 계산)로
    설명되는지 LLM으로 이중 검증합니다."""
    context = "\n\n---\n\n".join(
        f"[출처: {d.metadata.get('section_title', '약관')}, p.{d.metadata.get('page', '?')}]\n{d.page_content}"
        for d in documents
    ) if documents else "(검색된 근거 문서 없음)"

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, model_kwargs={"response_format": {"type": "json_object"}})
    prompt = ChatPromptTemplate.from_messages([
        ("system", """당신은 RAG 답변의 근거(grounding) 검증관입니다.
[개인 보험증권]과 [약관 검색 문서]를 바탕으로 [답변]이 실제 약관과 증권 수치에 부합하는지 정밀 평가하세요.

💡 너그러운 평가 가이드라인 (거짓 FAIL 방지):
1. 답변 속 보상금액이 [개인 보험증권]의 가입금액(예: 2,000만원, 1,000만원)이나 [약관 검색 문서]의 비율/한도(예: 15%, 30%, 1일당 2만원)를 바탕으로 정상 도출된 경우 grounded=true 입니다.
2. 가입금액 2,000만원 × 15% = 3,000,000원, 20,000원 × 7일 = 140,000원 같은 정당한 산술 계산 결과는 완벽한 근거 추론이므로 반드시 grounded=true 입니다.
3. 근거 자료에 완전히 나와있지 않은 가짜 질병명이나 엉뚱한 허위 숫자를 아예 지어냈을 때만 grounded=false 로 평가하세요.

응답 형식 JSON: {{"grounded": true 또는 false, "reason": "..."}}"""),
        ("human", "[개인 보험증권]\n{policy_md}\n\n[약관 검색 문서]\n{context}\n\n[답변]\n{answer}")
    ])
    chain = prompt | llm | JsonOutputParser()
    try:
        result = chain.invoke({"context": context, "answer": answer, "policy_md": policy_md})
        return bool(result.get("grounded", False)), result.get("reason", "")
    except Exception as e:
        return False, f"검증 오류: {e}"


def run_benchmark(questions=None, task_name: str = TASK_NAME):
    questions = questions or QUESTIONS
    policy_md = load_policy_md(task_name)
    results = []

    engine = InsuranceRAGEngine(task_name=task_name)
    for i, q in enumerate(questions, 1):
        if i > 1:
            time.sleep(3)
        print(f"\n[{i}/{len(questions)}] 질문: {q}")
        start = time.time()
        try:
            state = engine.invoke(q)
            elapsed = time.time() - start
            answer = state.get("generation", "")
            documents = state.get("documents", [])
            grounded, reason = grounding_check(answer, documents, policy_md)
        except Exception as e:
            elapsed = time.time() - start
            answer = f"실행 오류: {e}"
            documents = []
            grounded, reason = False, str(e)

        status = "PASS" if grounded else "FAIL"
        print(f"  -> {status} (grounded={grounded}, {elapsed:.1f}초)")

        results.append({
            "no": i,
            "question": q,
            "status": status,
            "grounded": grounded,
            "grounding_reason": reason,
            "elapsed_sec": round(elapsed, 1),
            "answer": answer,
            "referenced": [
                {"section": d.metadata.get("section_title"), "page": d.metadata.get("page")}
                for d in documents
            ]
        })

    with open("benchmark_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    passed = sum(1 for r in results if r["status"] == "PASS")
    avg_time = sum(r["elapsed_sec"] for r in results) / len(results) if results else 0
    print(f"\n{'='*60}")
    print(f"총 {len(results)}개 중 {passed}개 PASS ({passed/len(results)*100:.0f}%) / 평균 {avg_time:.1f}초")
    print(f"결과 저장: benchmark_results.json")
    print(f"{'='*60}")

    return results


if __name__ == "__main__":
    run_benchmark()
