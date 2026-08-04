import os
import csv
import json
import re
import fitz  # PyMuPDF

def sanitize_filename(filename: str) -> str:
    """파일명 특수문자 제거"""
    return re.sub(r'[\\/*?:"<>|]', "", filename).replace(" ", "_")

def extract_two_column_text(page, width_threshold_ratio=0.5) -> str:
    """
    2단(Multi-column) 레이아웃 PDF에서 좌/우 단의 글이 섞이지 않도록
    좌측 단(1단) -> 우측 단(2단) 순서로 텍스트를 정렬하여 추출합니다.
    """
    rect = page.rect
    page_width = rect.width
    mid_x = page_width * width_threshold_ratio  # 페이지 중앙 X 좌표
    
    # 텍스트 블록 추출 (x0, y0, x1, y1, text, block_no, block_type)
    blocks = page.get_text("blocks")
    
    left_blocks = []
    right_blocks = []
    full_width_blocks = []

    for b in blocks:
        # b[4]는 텍스트 내용, b[5]가 0이면 일반 텍스트 블록
        if len(b) < 5 or b[5] != 0:
            continue
            
        x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
        cleaned_b_text = text.strip()
        if not cleaned_b_text:
            continue

        # 블록의 중앙점 위치 계산
        block_mid_x = (x0 + x1) / 2
        
        # 전체 폭을 사용하는 헤더/푸터 구분 또는 좌/우 단 구분
        if (x1 - x0) > (page_width * 0.7):
            full_width_blocks.append((y0, cleaned_b_text))
        elif block_mid_x < mid_x:
            left_blocks.append((y0, cleaned_b_text))   # 좌측 단
        else:
            right_blocks.append((y0, cleaned_b_text))  # 우측 단

    # Y좌표(위->아래) 기준으로 정렬
    left_blocks.sort(key=lambda x: x[0])
    right_blocks.sort(key=lambda x: x[0])

    # 1단(좌측) 다 읽고 -> 2단(우측) 읽는 순서로 결합
    ordered_text = []
    
    # 좌측 단 텍스트
    for _, t in left_blocks:
        ordered_text.append(t)
        
    # 우측 단 텍스트
    for _, t in right_blocks:
        ordered_text.append(t)

    return "\n\n".join(ordered_text)

def run_step_1(task_folder_name: str):
    task_dir = os.path.join("tasks", task_folder_name)
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
        end_p = raw_toc[i + 1]["start_page"] - 1 if i + 1 < len(raw_toc) else total_pdf_pages
        
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
            if page_num > total_pdf_pages:
                break
            
            # fitz 0-indexed
            page = doc[page_num - 1]
            
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