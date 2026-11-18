"""Optional LangChain adapter for the same planner/editor prompts and validation rules."""

import os

from langchain_openai import ChatOpenAI


def invoke(messages, timeout):
    client = ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"].rstrip("/"),
        api_key=os.getenv("LLM_API_KEY") or "local",
        temperature=0,
        timeout=timeout,
        max_retries=0,
        max_tokens=400,
    )
    response = client.bind(response_format={"type": "json_object"}).invoke(
        [(message["role"], message["content"]) for message in messages]
    )
    if not isinstance(response.content, str):
        raise ValueError("O adaptador LangChain retornou conteúdo sem texto.")
    return response.content
