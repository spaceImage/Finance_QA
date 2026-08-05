# [벤치마크/검증용] 미리 정해둔 검증 질문들을 test_rag_graph.py의 Agentic RAG로 실행하고,
# 답변이 실제 검색된 근거 문서에 기반했는지(hallucination 없는지) LLM-judge로 이중 검증한 뒤,
# PASS/FAIL, 근거검증 결과, 소요시간을 benchmark_results.json으로 저장합니다.
import time
import json
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

from test_rag_graph import app
from rag_common import load_policy_md

TASK_NAME = "jang"

# 장석찬님 실제 약관/증권 기준으로 정답을 미리 알고 있는 검증 질문 10개
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
]


def grounding_check(answer: str, documents, policy_md: str) -> tuple[bool, str]:
    """생성된 답변이 실제로 검색된 근거 문서(+ 개인 보험증권 + 상식적인 비율 계산)로
    설명되는지 LLM으로 이중 검증합니다.
    ⚠️ 실제 답변은 [약관 검색 문서]뿐 아니라 [개인 보험증권](가입금액 등)도 근거로 삼으므로,
    검증할 때도 반드시 두 가지를 다 같이 줘야 합니다 (증권 없이 검증하면 정상적인 가입금액
    인용까지 "근거 없음"으로 오판하는 거짓 FAIL이 발생합니다)."""
    context = "\n\n---\n\n".join(d.page_content for d in documents) if documents else "(검색된 근거 문서 없음)"

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, model_kwargs={"response_format": {"type": "json_object"}})
    prompt = ChatPromptTemplate.from_messages([
        ("system", """당신은 RAG 답변의 근거(grounding) 검증관입니다.
[개인 보험증권]과 [약관 검색 문서]에 실제로 없는 숫자나 조건을 [답변]이 지어내지 않았는지 확인하세요.
답변 속 금액/조건이 두 자료 중 하나에 직접 나와 있거나, 약관의 비율(%)과 증권의 가입금액을 곱하는
상식적인 계산으로 설명 가능하면 grounded=true 입니다. 두 자료 어디로도 설명할 수 없는 내용을
지어냈을 때만 grounded=false이고 이유를 한 문장으로 적으세요.

응답은 반드시 JSON: {{"grounded": true 또는 false, "reason": "..."}}"""),
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

    for i, q in enumerate(questions, 1):
        if i > 1:
            # ⭐ 질문을 쉬지 않고 연달아 쏘면 OpenAI 레이트리밋에 걸려 SDK가 내부적으로
            # 재시도(백오프)하면서 개별 소요시간이 부풀려집니다. 짧게 텀을 둬서
            # 벤치마크 타이밍이 실제 단일 질문 응답속도에 가깝게 나오도록 합니다.
            time.sleep(3)
        print(f"\n[{i}/{len(questions)}] 질문: {q}")
        start = time.time()
        try:
            state = app.invoke({
                "question": q,
                "section_filters": [],
                "documents": [],
                "generation": "",
                "loop_count": 0
            })
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
