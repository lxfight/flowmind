from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings

settings = get_settings()


class LLMService:
    def __init__(self):
        self.client: Optional[AsyncOpenAI] = None
        self._init_client()

    def _init_client(self):
        if settings.llm_api_key:
            client_kwargs = {"api_key": settings.llm_api_key}
            if settings.llm_base_url:
                client_kwargs["base_url"] = settings.llm_base_url
            self.client = AsyncOpenAI(**client_kwargs)

    async def chat(self, messages: list[dict], system_prompt: str = "") -> str:
        """Send chat request to LLM."""
        if not self.client:
            return "LLM 未配置，请在环境变量中设置 LLM_API_KEY"

        full_messages = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(messages)

        response = await self.client.chat.completions.create(
            model=settings.llm_model,
            messages=full_messages,
            temperature=0.7,
            max_tokens=4096,
        )
        return response.choices[0].message.content or ""

    async def generate_tasks(self, instruction: str, project_context: str) -> list[dict]:
        """Generate structured tasks from natural language instruction."""
        system_prompt = """你是一个任务管理助手。根据用户的指令，将任务拆解为结构化的任务列表。
以 JSON 数组格式返回，每个任务包含 title、description、priority(0-4)。
只返回 JSON，不要包含其他内容。"""

        prompt = f"""项目背景：
{project_context}

用户指令：{instruction}

请将上述指令拆解为具体的任务，以 JSON 数组格式返回。"""

        result = await self.chat(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system_prompt,
        )
        return self._parse_json_result(result)

    async def suggest_status(self, task_title: str, task_description: str, existing_statuses: list[str]) -> str:
        """Suggest which status column a task belongs in."""
        prompt = f"""任务标题：{task_title}
任务描述：{task_description}
可选状态：{', '.join(existing_statuses)}

根据任务内容，判断这个任务最可能属于哪个状态？只返回状态名称。"""

        result = await self.chat(
            messages=[{"role": "user", "content": prompt}],
            system_prompt="你是一个任务管理助手。只返回最匹配的状态名称，不要包含其他内容。",
        )
        return result.strip()

    async def generate_report(self, tasks_data: str, project_name: str) -> str:
        """Generate a project status report."""
        prompt = f"""项目：{project_name}
任务数据：{tasks_data}

请生成一份简洁的项目状态报告，包含：
1. 总体进度
2. 各状态任务分布
3. 高风险/延迟任务提醒
4. 建议"""
        return await self.chat(
            messages=[{"role": "user", "content": prompt}],
            system_prompt="你是一个项目管理助手。请生成专业、简洁的项目报告。",
        )

    def _parse_json_result(self, text: str) -> list[dict]:
        """Try to extract JSON from LLM response."""
        import json
        import re

        # Try to find JSON array in the response
        json_match = re.search(r'\[.*\]', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        return []


# Global singleton
llm_service = LLMService()
