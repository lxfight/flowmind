
from openai import AsyncOpenAI

from app.services.config_service import config_service


class LLMService:
    """Chat completions against an OpenAI-compatible endpoint.

    The client is rebuilt per call from config_service so runtime config
    changes (API key / base URL / model) take effect immediately without
    restarting the process.
    """

    async def _build_client(self) -> tuple[AsyncOpenAI | None, str]:
        """Return (client, model) from the current effective config."""
        api_key = await config_service.get("llm_api_key")
        base_url = await config_service.get("llm_base_url")
        model = await config_service.get("llm_model")
        if not api_key:
            return None, model
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        return AsyncOpenAI(**client_kwargs), model

    async def chat(self, messages: list[dict], system_prompt: str = "") -> str:
        """Send chat request to LLM."""
        client, model = await self._build_client()
        if client is None:
            return "LLM 未配置，请在管理页面或环境变量中设置 LLM_API_KEY"

        full_messages = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(messages)

        response = await client.chat.completions.create(
            model=model,
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

    async def generate_report(self, prompt: str) -> str:
        """Generate a project status report from a fully-built report prompt.

        The prompt (built by report_service.build_report_prompt) already
        contains the project context, precomputed statistics, the required
        output skeleton, and anti-hallucination instructions.
        """
        from app.services.report_service import REPORT_SYSTEM_PROMPT

        return await self.chat(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=REPORT_SYSTEM_PROMPT,
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
