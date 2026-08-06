# [개발용 단축 스크립트] "jang" 한 명만 대상으로 step_1~3을 한 번에 재실행하는 원클릭 스크립트.
# 여러 인물을 다루려면 main.py를 쓰세요. 이 파일은 파싱 로직(pipeline/step_1.py)을 고친 뒤
# 빠르게 재검증할 때 쓰는 용도입니다.
from pipeline.step_1 import run_step_1
from pipeline.step_2 import run_step_2
from pipeline.step_3 import run_step_3

if __name__ == "__main__":
    task_name = "jang"
    print(f"=== 1단계: parsed_json_parts 생성 ===")
    run_step_1(task_name)

    print(f"\n=== 2단계: final_output 합본 생성 ===")
    run_step_2(task_name)

    print(f"\n=== 3단계: Vector DB (Supabase pgvector) 재구축 ===")
    run_step_3(task_name)

    print(f"\n🎉 [성공] 모든 데이터베이스 재구축이 완료되었습니다!")
