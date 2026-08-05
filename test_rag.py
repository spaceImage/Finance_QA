# [RAG 데모 ①: 텍스트 답변] 보험증권 + 약관 검색결과를 함께 프롬프트에 넣어, 사고과정과
# 출처가 포함된 사람이 읽기 좋은 형태(markdown 텍스트)로 답변을 생성하는 간단한 RAG. 터미널에서 직접 질문/답변 확인용.
import sys
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from rag_common import get_embeddings, get_vectorstore, load_policy_md

DEFAULT_TASK_NAME = "jang"


def get_contract_qa_chain(task_name: str = DEFAULT_TASK_NAME):
    embeddings = get_embeddings()
    vectorstore = get_vectorstore(embeddings)
    # ⭐ Supabase는 공용 documents 테이블을 여러 인물이 같이 쓰므로,
    #    반드시 task_name으로 필터링해서 다른 사람 데이터가 섞이지 않게 합니다.
    retriever = vectorstore.as_retriever(
        search_kwargs={"k": 10, "filter": {"task_name": task_name}}
    )

    llm = ChatOpenAI(model="gpt-4o", temperature=0)

    prompt_template = """
당신은 보험 약관 및 보험증권 분석 전문 AI 서비스입니다.
제공된 [개인 보험증권]과 [약관 검색 결과 (Vector DB)]를 바탕으로 사용자의 질문에 정확히 답변하세요.

답변을 작성할 때는 아래의 규칙을 엄격히 준수하세요:
1. **사고 과정 (Reasoning Chain)**: 질문을 분석하고, 증권과 약관에서 필요한 정보를 찾아 결론에 도달하는 논리적 과정을 단계별로 설명하세요.
2. **최종 답변**: 질문에 대한 명쾌한 요약 및 답변을 작성하세요.
3. **근거 및 출처 (Citations)**:
   - 증권 기준(가입금액, 포함 특약 등): `[출처: 보험증권]` 표기
   - 약관 기준(면책 사유, 지급 조건 등): `[출처: 약관 DB - 페이지/섹션]` 표기

---
[개인 보험증권]
{policy_md}

---
[약관 검색 결과 (Vector DB)]
{약관_docs}

---
[사용자 질문]
{question}

---
[답변 양식]
### 🧠 사고 로직 및 분석 과정 (Reasoning)
1. **질문 분석**: ...
2. **보험증권 확인**: ...
3. **약관 규정 확인**: ...
4. **종합 결론 도출**: ...

---
### 💡 최종 답변
(명확하고 가독성 높은 답변 작성)

---
### 📌 근거 및 출처
- **보험증권 출처**: ...
- **보험약관 출처**: ...
"""

    prompt = ChatPromptTemplate.from_template(prompt_template)
    chain = prompt | llm | StrOutputParser()

    return retriever, chain

def ask_insurance_question(query: str, task_name: str = DEFAULT_TASK_NAME):
    print(f"\n🔍 [질문 입력]: '{query}' (대상: {task_name})")

    # 1. 개인 증권 마크다운 로드
    policy_md_text = load_policy_md(task_name)

    # 2. Vector DB 약관 검색
    retriever, chain = get_contract_qa_chain(task_name)
    retrieved_docs = retriever.invoke(query)

    # 검색된 약관 본문 정리
    formatted_docs = ""
    for i, doc in enumerate(retrieved_docs, 1):
        source_page = doc.metadata.get("page", "페이지 정보 없음")
        title = doc.metadata.get("section_title", doc.metadata.get("source", "약관"))
        formatted_docs += f"\n[약관 검색 문서 {i}] (출처: {title}, p.{source_page})\n{doc.page_content}\n"

    # 3. LLM 추론 및 답변 생성
    print("🤖 사고 과정 및 근거 분석 중...\n")
    response = chain.invoke({
        "policy_md": policy_md_text,
        "약관_docs": formatted_docs,
        "question": query
    })

    print("==================================================================")
    print(response)
    print("==================================================================")

if __name__ == "__main__":
    # 1) 명령어 실행 시 인자로 질문이 들어온 경우 (예: python test_rag.py "질문내용")
    if len(sys.argv) > 1:
        user_query = " ".join(sys.argv[1:])
        ask_insurance_question(user_query)
    # 2) 인자가 없는 경우 터미널 대화형 입력으로 받기
    else:
        try:
            while True:
                user_query = input("\n💬 질문을 입력하세요 (종료하려면 'exit' 또는 'q' 입력): ").strip()
                if not user_query:
                    continue
                if user_query.lower() in ["exit", "q", "종료"]:
                    print("👋 프로그램을 종료합니다.")
                    break
                ask_insurance_question(user_query)
        except KeyboardInterrupt:
            print("\n👋 프로그램을 종료합니다.")
