# [1단계: PDF 파싱] 원본 약관 PDF(raw_policy.pdf)를 toc_config.csv의 특약별 페이지 범위대로 잘라
# 텍스트를 추출하고, tasks/{task_name}/parsed_json_parts/ 밑에 특약별 JSON 파일로 저장합니다.
import os
import csv
import json
import re
from pathlib import Path
import fitz  # PyMuPDF

# 물리적 PDF 페이지 = 약관 인쇄(로직) 페이지 + PAGE_OFFSET (표지/목차/가이드 페이지 오프셋)
PAGE_OFFSET = 12

# backend/pipeline/step_1.py -> 레포 루트 (tasks/ 는 backend/ 밖에 있음)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

def sanitize_filename(filename: str) -> str:
    """파일명 특수문자 제거"""
    return re.sub(r'[\\/*?:"<>|]', "", filename).replace(" ", "_")

def extract_two_column_text(page, width_threshold_ratio=0.5) -> str:
    """
    2단(Multi-column) 레이아웃 PDF에서 좌/우 단의 글이 섞이지 않도록
    좌측 단(1단) -> 우측 단(2단) 순서로 텍스트를 정렬하여 추출합니다.
    단일 컬럼(전체 폭) 페이지에서는 Y좌표 순서(자연스러운 읽기 순서)로 병합합니다.
    """
    rect = page.rect
    page_width = rect.width
    mid_x = page_width * width_threshold_ratio  # 페이지 중앙 X 좌표
    # 실제 '좁은 단(column)'으로 볼 수 있는 최대 폭 (반 페이지 폭보다 확실히 좁을 때만)
    narrow_width_limit = page_width * 0.45

    # 텍스트 블록 추출 (x0, y0, x1, y1, text, block_no, block_type)
    blocks = page.get_text("blocks")

    left_blocks = []   # (y0, x0, text) - 좁은 좌측 단
    right_blocks = []  # (y0, x0, text) - 좁은 우측 단
    wide_blocks = []   # (y0, x0, text) - 전체 폭에 가까운 일반 문단/헤더/푸터

    for b in blocks:
        # b[4]는 텍스트 내용, b[6]이 0이면 일반 텍스트 블록 (b[5]는 블록 순번이라 필터에 쓰면 안 됨)
        if len(b) < 7 or b[6] != 0:
            continue

        x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
        cleaned_b_text = text.strip()
        if not cleaned_b_text:
            continue

        block_mid_x = (x0 + x1) / 2
        block_width = x1 - x0

        if block_width <= narrow_width_limit:
            if block_mid_x < mid_x:
                left_blocks.append((y0, x0, cleaned_b_text))   # 좌측 단
            else:
                right_blocks.append((y0, x0, cleaned_b_text))  # 우측 단
        else:
            wide_blocks.append((y0, x0, cleaned_b_text))       # 전체 폭 문단/헤더/푸터

    # 실제로 좌/우 단이 동시에 존재하는 '진짜 2단 레이아웃' 페이지인지 판단
    is_two_column_page = len(left_blocks) >= 2 and len(right_blocks) >= 2

    if is_two_column_page:
        left_blocks.sort(key=lambda b: b[0])
        right_blocks.sort(key=lambda b: b[0])

        col_y_min = min(b[0] for b in left_blocks + right_blocks)
        col_y_max = max(b[0] for b in left_blocks + right_blocks)

        before = sorted([b for b in wide_blocks if b[0] < col_y_min], key=lambda b: b[0])
        after = sorted([b for b in wide_blocks if b[0] > col_y_max], key=lambda b: b[0])
        # 2단 영역 안에 끼어든 전체 폭 블록(구분선/소제목 등)은 Y좌표 순서로 좌/우 단과 함께 병합
        inside = [b for b in wide_blocks if col_y_min <= b[0] <= col_y_max]

        ordered = (
            before
            + sorted(left_blocks + inside, key=lambda b: b[0])
            + right_blocks
            + after
        )
    else:
        # 단일 컬럼 페이지: 모든 블록을 Y좌표(동일 줄이면 X좌표) 순서로 자연스럽게 병합
        ordered = sorted(left_blocks + right_blocks + wide_blocks, key=lambda b: (b[0], b[1]))

    return "\n\n".join(t for _, _, t in ordered)

def run_step_1(task_folder_name: str):
    task_dir = os.path.join(PROJECT_ROOT, "tasks", task_folder_name)
    input_dir = os.path.join(task_dir, "inputs")
    output_dir = os.path.join(task_dir, "parsed_json_parts")
    
    csv_path = os.path.join(input_dir, "toc_config.csv")
    pdf_path = os.path.join(input_dir, "raw_policy.pdf")
    
    if not os.path.exists(csv_path) or not os.path.exists(pdf_path):
        print(f"❌ [오류] {csv_path} 또는 {pdf_path} 파일이 없습니다.")
        return

    os.makedirs(output_dir, exist_ok=True)
    
    doc = fitz.open(pdf_path)
    total_pdf_pages = len(doc)
    
    # 1. CSV 파일 읽기
    raw_toc = []
    with open(csv_path, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            start_p_str = row.get("start_page", "").strip()
            if start_p_str.isdigit():
                raw_toc.append({
                    "person_name": row.get("person_name", "").strip(),
                    "section_title": row.get("section_title", "").strip(),
                    "start_page": int(start_p_str)
                })
    
    raw_toc.sort(key=lambda x: x["start_page"])
    
    # 2. end_page 자동 계산
    toc_list = []
    for i, item in enumerate(raw_toc):
        sec_id = i + 1
        start_p = item["start_page"]
        # 마지막 섹션의 end_page는 '물리적' 총 페이지 수가 아니라, 오프셋을 뺀 '로직(인쇄)' 마지막 페이지여야 함
        end_p = raw_toc[i + 1]["start_page"] - 1 if i + 1 < len(raw_toc) else (total_pdf_pages - PAGE_OFFSET)
        
        toc_list.append({
            "person_name": item["person_name"],
            "section_id": sec_id,
            "section_title": item["section_title"],
            "start_page": start_p,
            "end_page": end_p
        })

    print(f"\n🚀 [{task_folder_name}] 2단(Multi-Column) 레이아웃 정렬 파싱 시작...")

    # 3. 목차별 JSON 생성
    for item in toc_list:
        sec_id = item["section_id"]
        title = item["section_title"]
        start_p = item["start_page"]
        end_p = item["end_page"]
        person = item["person_name"]
        
        section_data = {
            "metadata": {
                "task_name": task_folder_name,
                "person_name": person,
                "section_id": sec_id,
                "section_title": title,
                "start_page": start_p,
                "end_page": end_p,
                "total_section_pages": (end_p - start_p + 1),
                "source_pdf": "raw_policy.pdf"
            },
            "pages": []
        }
        
        for page_num in range(start_p, end_p + 1):
            # 💡 물리적 페이지 번호 = 약관 인쇄 페이지 번호 + 오프셋 (목차/가이드 오프셋 반영)
            physical_page_num = page_num + PAGE_OFFSET
            if physical_page_num > total_pdf_pages:
                break
            
            # fitz 0-indexed
            page = doc[physical_page_num - 1]
            
            # ⭐ 2단 구조 정렬 텍스트 추출
            parsed_text = extract_two_column_text(page)
            
            section_data["pages"].append({
                "page_number": page_num,
                "text": parsed_text
            })
        
        safe_title = sanitize_filename(title)
        json_filename = f"{sec_id:02d}_{safe_title}.json"
        json_filepath = os.path.join(output_dir, json_filename)
        
        with open(json_filepath, "w", encoding="utf-8") as f:
            json.dump(section_data, f, ensure_ascii=False, indent=2)
            
        print(f"  [파싱 완료] {json_filename} ({start_p}~{end_p}p)")

    doc.close()
    print(f"\n✅ step_1 완료! 2단 문서 정렬 파싱이 성공했습니다.")