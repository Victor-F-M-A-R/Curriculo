# Executar o Farol com Qwen em CPU

Esta receita foi testada com Linux x86-64. Reserve cerca de 1,3 GB de armazenamento para o modelo e o servidor. O endereço local usado nesta configuração dispensa cadastro e chave. Os manuais, as perguntas e as respostas ficam no computador que roda os dois processos.

## Iniciar o servidor local

```sh
mkdir -p "$HOME/.cache/farol-llm"
cd "$HOME/.cache/farol-llm"
curl -fL --retry 2 -o llama-server.tar.gz \
  https://github.com/ggml-org/llama.cpp/releases/download/b12503/llama-b12503-bin-ubuntu-x64.tar.gz
curl -fL --retry 2 -o qwen2.5-1.5b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf
echo '0d585f8a78ffdfdc4f6303a089aaa1379c15323b33483b6548c85c774a376a9d  llama-server.tar.gz' | sha256sum -c -
echo '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e  qwen2.5-1.5b-instruct-q4_k_m.gguf' | sha256sum -c -
tar -xzf llama-server.tar.gz
./llama-b12503/llama-server --model qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --alias qwen2.5-1.5b --host 127.0.0.1 --port 18176 \
  --ctx-size 4096 --threads 4 --threads-batch 4 --parallel 1 \
  --gpu-layers 0 --no-webui
```

## Conectar a API

Em um segundo terminal do mesmo computador, ative o ambiente Python do Farol e execute os comandos a seguir a partir de `farol/service`.

```sh
export LLM_BASE_URL=http://127.0.0.1:18176/v1
export LLM_MODEL=qwen2.5-1.5b
export LLM_TIMEOUT_SECONDS=90
python - <<'PY'
from search import Index, answer
result = answer(Index(), "Quantas falhas na WAN Ipê fazem a Cedro assumir?")
evidence = result["evidence"][0]
print(result["mode"], evidence["id"], result["answer"], sep="\n")
assert result["mode"] == "seleção por LLM"
assert evidence["id"] == "RB-01#s1"
assert evidence["quote"] in evidence["text"]
assert "três falhas" in evidence["quote"]
PY
```

O mesmo ambiente deve estar ativo ao iniciar o serviço FastAPI para testar a seleção pela interface. Se o backend roda em um contêiner, forneça um endereço alcançável pela sua rede interna Docker. A integração também admite `LLM_TRANSPORT=langchain` após instalar as dependências opcionais do adaptador. A pontuação da suíte mede se o trecho veio da seção esperada e se o sistema se abstém quando falta evidência.

## Resultado da versão entregue

O ensaio final usou 22 perguntas, 4 threads de CPU e contexto de 4.096 tokens. Em 17 das 18 perguntas respondíveis, o sistema citou a seção esperada. As quatro perguntas fora da cobertura receberam abstenção. Foram 15 seleções diretas pelo modelo, duas respostas extrativas de contingência e cinco abstenções, incluindo uma indevida. A execução completa levou 77,509 s, com mediana de 4,001 s por pergunta neste equipamento.

A revisão do caso P1 verificou também a resposta de conteúdo: o excerto final inclui a periodicidade de 15 minutos. O ensaio é pequeno, elaborado no desenvolvimento, e mede principalmente escolha de fonte e abstenção. Use um conjunto independente para avaliar outras perguntas e a qualidade semântica geral.

[Resultados finais por pergunta](evidence/qwen-final.json) · [Primeiro ensaio](evidence/qwen-before.json) · [Consulta direta HTTPX](evidence/flow-httpx.json) · [Consulta via LangChain](evidence/flow-langchain.json)

O adaptador opcional é instalado com `python -m pip install -r requirements-langchain.txt` no diretório `farol/service`. Defina `LLM_TRANSPORT=langchain` junto às três variáveis do servidor local. O perfil Docker padrão usa o cliente HTTPX.
