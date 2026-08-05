# [2단계: JSON 병합] step_1이 특약별로 쪼개 놓은 parsed_json_parts/*.json 파일들을
# 사람 한 명 기준 final_output/{task_name}_final.json 하나로 합칩니다.
import os
import json

def run_step_2(task_folder_name: str):
    task_dir = os.path.join("tasks", task_folder_name)
    parts_dir = os.path.join(task_dir, "parsed_json_parts")
    final_dir = os.path.join(task_dir, "final_output")

    if not os.path.exists(parts_dir) or not os.listdir(parts_dir):
        print(f"\n❌ [오류] {parts_dir} 폴더에 검토할 JSON 파일이 없습니다.")
        print("👉 먼저 'step_1'을 실행해주세요.")
        return

    os.makedirs(final_dir, exist_ok=True)
    json_files = sorted([f for f in os.listdir(parts_dir) if f.endswith(".json")])
    
    print(f"\n🚀 [{task_folder_name}] 검토 완료된 {len(json_files)}개 JSON 병합 시작...")

    final_document = {
        "task_name": task_folder_name,
        "total_sections": len(json_files),
        "sections": []
    }

    for file_name in json_files:
        file_path = os.path.join(parts_dir, file_name)
        
        with open(file_path, "r", encoding="utf-8") as f:
            section_data = json.load(f)
            
        final_document["sections"].append(section_data)

    # 최종 병합 JSON 파일 저장
    final_filename = f"{task_folder_name}_final.json"
    final_filepath = os.path.join(final_dir, final_filename)

    with open(final_filepath, "w", encoding="utf-8") as f:
        json.dump(final_document, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 [작업 완결] 최종 단일 JSON 파일이 성공적으로 출력되었습니다!")
    print(f"📄 최종 파일 위치: {os.path.abspath(final_filepath)}")