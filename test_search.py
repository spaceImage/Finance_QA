# [RAG 데모 ②: JSON 응답] 약관 검색 + 답변 결과를 구조화된 JSON(질문/답변/참조페이지 전문)으로
# 반환합니다. 화면 출력용이 아니라 다른 프로그램(백엔드 API 등)이 그대로 소비하기 좋은 형태.
import json
from langchain_openai import ChatOpenAI

from rag_common import get_embeddings, get_vectorstore

DEFAULT_TASK_NAME = "jang"


def search_and_generate_rag_json(user_query: str, top_k: int = 3, task_name: str = DEFAULT_TASK_NAME) -> str:
    """
    사용자의 질문을 받아 Vector DB에서 유사한 약관 페이지를 검색하고,
    참조된 모든 페이지의 정보(메타데이터, 본문 전체)와 LLM 답변을 JSON 형식으로 반환합니다.
    """
    try:
        embeddings = get_embeddings()
        vectorstore = get_vectorstore(embeddings)
    except ValueError as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    # ⭐ Supabase의 공용 documents 테이블에서 이 인물(task_name)의 데이터만 검색
    #    (반환값은 (Document, similarity) 튜플이며, similarity는 코사인 유사도로 1에 가까울수록 유사)
    results = vectorstore.similarity_search_with_relevance_scores(
        user_query, k=top_k, filter={"task_name": task_name}
    )

    if not results:
        return json.dumps({"query": user_query, "answer": "관련된 약관 내용을 찾을 수 없습니다.", "referenced_pages": []}, ensure_ascii=False)

    # 2. 참조된 페이지 정보 구조화 (JSON 변환용 List)
    referenced_pages = []
    context_text_list = []

    for doc, score in results:
        page_data = {
            "section_title": doc.metadata.get("section_title"),
            "page_number": doc.metadata.get("page"),
            "source_pdf": doc.metadata.get("source_pdf"),
            "similarity_score": round(float(score), 4),  # 1에 가까울수록 유사 (코사인 유사도)
            "full_content": doc.page_content  # ⭐ 참조된 페이지의 전체 텍스트
        }
        referenced_pages.append(page_data)
        context_text_list.append(doc.page_content)

    # 3. LLM (gpt-4o-mini)에 검색 결과 전달하여 답변 생성
    context_combined = "\n\n---\n\n".join(context_text_list)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    prompt = f"""당신은 보험 약관 전문 AI 상담원입니다.
아래 제공된 [약관 참고 문서]만을 바탕으로 사용자의 질문에 친절하고 정확하게 답변해 주세요.

[약관 참고 문서]
{context_combined}

[사용자 질문]
{user_query}
"""

    response = llm.invoke(prompt)

    # 4. 최종 결과 JSON 구성
    output_data = {
        "query": user_query,
        "answer": response.content,
        "total_referenced_count": len(referenced_pages),
        "referenced_pages": referenced_pages  # 참조 페이지 전체 내용 저장된 리스트
    }

    # JSON 문자열로 인코딩하여 반환
    return json.dumps(output_data, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    query = input("\n질문할 내용을 입력하세요: ").strip()
    if query:
        json_result = search_and_generate_rag_json(query, top_k=3)
        print("\n=================== 📦 최종 JSON 출력 ===================")
        print(json_result)
