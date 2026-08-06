# [메인 실행 파일] 터미널 메뉴로 사람(task) 등록 -> PDF 파싱 -> JSON 병합 -> 벡터DB 적재까지
# pipeline/step_1~3.py를 순서대로 실행해주는 대화형 CLI. 실제로 실행하는 진입점은 이 파일입니다.
import os
import sys
from pipeline.step_1 import run_step_1
from pipeline.step_2 import run_step_2
from pipeline.step_3 import run_step_3
from rag_common import TASKS_DIR

BASE_TASKS_DIR = str(TASKS_DIR)

def create_new_task():
    print("\n--- [1단계] 새 작업 폴더 생성 ---")
    task_name = input("생성할 작업명을 입력하세요 (예: jang): ").strip()
    if not task_name:
        print("❌ 작업명이 입력되지 않았습니다.")
        return

    task_dir = os.path.join(BASE_TASKS_DIR, task_name)
    inputs_dir = os.path.join(task_dir, "inputs")
    parts_dir = os.path.join(task_dir, "parsed_json_parts")
    final_dir = os.path.join(task_dir, "final_output")
    vector_dir = os.path.join(task_dir, "vector_db")

    os.makedirs(inputs_dir, exist_ok=True)
    os.makedirs(parts_dir, exist_ok=True)
    os.makedirs(final_dir, exist_ok=True)
    os.makedirs(vector_dir, exist_ok=True)

    print(f"\n✅ 작업 폴더 세팅 완료!")
    print(f"📁 파일 투입 위치: {os.path.abspath(inputs_dir)}")
    print("  1) toc_config.csv")
    print("  2) raw_policy.pdf\n")

def list_tasks():
    if not os.path.exists(BASE_TASKS_DIR):
        return []
    return [d for d in os.listdir(BASE_TASKS_DIR) if os.path.isdir(os.path.join(BASE_TASKS_DIR, d))]

def select_task_menu(action_name):
    tasks = list_tasks()
    if not tasks:
        print("\n❌ 등록된 작업이 없습니다. 먼저 '1. 새 작업 생성'을 진행하세요.")
        return None

    print(f"\n--- [{action_name}] 대상을 선택하세요 ---")
    for idx, task in enumerate(tasks, 1):
        print(f" [{idx}] {task}")
    
    choice = input("\n번호 입력: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(tasks):
        return tasks[int(choice) - 1]
    else:
        print("❌ 잘못된 선택입니다.")
        return None

def main():
    while True:
        print("\n==========================================")
        print(" 📄 보험약관 구조화 & Vector DB 구축 파이프라인")
        print("==========================================")
        print(" 1. [1단계] 새 작업 폴더 생성")
        print(" 2. [2단계] PDF 파싱 & 목차별 1차 JSON 생성 (pipeline/step_1.py)")
        print(" 3. [3단계] 1차 JSON 검토 후 최종 단일 JSON 병합 (pipeline/step_2.py)")
        print(" 4. [4단계] 최종 JSON 기반 Vector DB 생성 (pipeline/step_3.py)")
        print(" 0. 종료")
        print("==========================================")
        
        menu = input("메뉴 선택: ").strip()

        if menu == "1":
            create_new_task()

        elif menu == "2":
            task_name = select_task_menu("step_1 실행")
            if task_name:
                run_step_1(task_name)

        elif menu == "3":
            task_name = select_task_menu("step_2 실행 (최종 JSON 병합)")
            if task_name:
                run_step_2(task_name)

        elif menu == "4":
            task_name = select_task_menu("step_3 실행 (Vector DB 구축)")
            if task_name:
                run_step_3(task_name)

        elif menu == "0":
            print("\n프로그램을 종료합니다.")
            sys.exit(0)
        else:
            print("❌ 잘못된 번호입니다.")

if __name__ == "__main__":
    main()