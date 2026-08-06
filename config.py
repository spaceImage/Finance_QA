"""
Agentic Orchestration Model Config & System Settings
AGENT.MD 의 Model Orchestration Strategy 명세에 따른 Node별 LLM 모델 설정 모듈
"""

import os
from typing import Dict

# Node별 기본 모델 매핑 (초고속 RAG 추론을 위해 gpt-4o-mini 적용)
DEFAULT_MODEL_CONFIG: Dict[str, str] = {
    "planner": os.getenv("MODEL_PLANNER", "gpt-4o-mini"),
    "validator": os.getenv("MODEL_VALIDATOR", "gpt-4o-mini"),
    "router": os.getenv("MODEL_ROUTER", "gpt-4o-mini"),
    "retrieval": os.getenv("MODEL_RETRIEVAL", "gpt-4o-mini"),
    "reasoning": os.getenv("MODEL_REASONING", "gpt-4o-mini"),
    "context_validator": os.getenv("MODEL_CONTEXT_VALIDATOR", "gpt-4o-mini"),
    "response": os.getenv("MODEL_RESPONSE", "gpt-5-mini"),
}

class ModelConfig:
    def __init__(self, overrides: Dict[str, str] = None):
        self._config = DEFAULT_MODEL_CONFIG.copy()
        if overrides:
            self._config.update(overrides)

    def get_model(self, node_name: str) -> str:
        """Node 이름에 해당하는 지정 LLM 모델명을 반환합니다."""
        return self._config.get(node_name, "gpt-4o-mini")

    def set_model(self, node_name: str, model_name: str):
        self._config[node_name] = model_name

    def to_dict(self) -> Dict[str, str]:
        return self._config.copy()

# 싱글톤 Config 인스턴스
global_model_config = ModelConfig()
