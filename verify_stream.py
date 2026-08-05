import asyncio
import sys
from test_rag_graph import InsuranceRAGEngine

# UTF-8 출력 보장
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

async def main():
    query = "장석찬님이 재해골절 시 받을 수 있는 보험금은 얼마인가요?"
    print(f"📡 [테스트 시작] 질문: '{query}'")
    
    engine = InsuranceRAGEngine(task_name="jang")
    
    print("\n--- 랭그래프 스트리밍 이벤트 스트림 시작 ---")
    async for event in engine.astream_rag(query):
        evt_type = event["event"]
        node = event["node"]
        data = event["data"]
        
        if evt_type == "node_start":
            print(f"\n▶️ [Node Start] {node}")
        elif evt_type == "node_end":
            print(f"\n⏹️ [Node End] {node} | 결과 데이터: {data}")
        elif evt_type == "token":
            # 토큰 실시간 출력
            print(data, end="", flush=True)

    print("\n\n--- 랭그래프 스트리밍 이벤트 스트림 종료 ---")

if __name__ == "__main__":
    asyncio.run(main())
