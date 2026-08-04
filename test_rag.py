import os
import json
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import Chroma

load_dotenv()

TASK_NAME = "jang"
VECTOR_DB_DIR = f"tasks/{TASK_NAME}/vector_db"

def search_and_generate_rag_json(user_query: str, top_k: int = 3) -> str:
    """
    사용자의 질문을 받아 Vector DB에서 유사한 약관 페이지를 검색하고,
    참조된 모든 페이지의 정보(메타데이터, 본문 전체)와 LLM 답변을 JSON 형식으로 반환합니다.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return json.dumps({"error": "OPENAI_API_KEY가 설정되지 않았습니다."}, ensure_ascii=False)

    # 1. Vector DB 로드 및 유사도 검색
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small", openai_api_key=api_key)
    vectorstore = Chroma(persist_directory=VECTOR_DB_DIR, embedding_function=embeddings)

    # 거리 점수(Score)와 함께 검색
    results = vectorstore.similarity_search_with_score(user_query, k=top_k)

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
            "similarity_score": round(float(score), 4),
            "full_content": doc.page_content  # ⭐ 참조된 페이지의 전체 텍스트
        }
        referenced_pages.append(page_data)
        context_text_list.append(doc.page_content)

    # 3. LLM (gpt-4o-mini)에 검색 결과 전달하여 답변 생성
    context_combined = "\n\n---\n\n".join(context_text_list)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, openai_api_key=api_key)

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