"""Build the self-contained portfolio gallery. Run with Python 3.10+ from a Git checkout."""
import argparse
import html
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
CASES={
    "doca":("Doca Norte","O que acontece se dois operadores reservarem a mesma doca?",
            "A leitura na tela pode envelhecer entre a seleção e o clique. O serviço Spring trava a linha, compara a versão recebida e persiste a mudança com um evento na mesma transação.",
            "Duas operações simultâneas sobre D1 produziram um sucesso e um conflito. A regra passou em H2 e PostgreSQL.",
            "O aplicativo Flutter consome a leitura da portaria. O teste em aparelho físico ainda é necessário para medir biometria e fluidez nativa.",
            "doca-norte/server/src/main/java/br/dev/docanorte/Yard.java","docker compose up --build -d doca portaria"),
    "lastro":("Lastro","Como rejeitar um extrato sem deixar meio lote gravado?",
            "O parser converte valores em centavos e confere datas e referências. A transação inclui todos os recebimentos e o evento de auditoria. Um novo envio do mesmo arquivo encontra sua impressão digital.",
            "O teste colocou uma referência nova no início e uma duplicada no final. O banco reverteu a primeira linha e o evento. A suíte passou em SQLite e PostgreSQL.",
            "A projeção para Cosmos reutiliza o ID do evento em cada upsert. O adaptador foi compilado e aguarda validação com uma instância real.",
            "lastro/server/Book.cs","docker compose up --build -d lastro"),
    "farol":("Farol","Como mostrar de onde saiu a resposta de um agente?",
            "O arquivista escolhe a busca no acervo ou em um manual. O índice SQLite-vec recupera as seções. O editor extrai a resposta e o servidor verifica se a citação existe literalmente na fonte.",
            "Um modelo Qwen de 1,5 bilhão de parâmetros foi executado em CPU. A fila de revisão percorreu FastAPI, n8n e .NET. Reenviar o evento preservou uma única linha de revisão.",
            "O conjunto tem 22 perguntas de desenvolvimento. Uma pergunta sobre mudança programada revelou uma recusa indevida. A matriz identifica quais métricas medem recuperação e quais exigem revisão humana.",
            "farol/service/search.py","docker compose up --build -d farol"),
}

def bundle(dest):
    with tempfile.TemporaryDirectory() as folder:
        archive=Path(folder)/"source.zip"
        history=Path(folder)/"historico.bundle"
        subprocess.run(["git","archive","--format=zip","-o",str(archive),"HEAD"],cwd=ROOT,check=True)
        subprocess.run(["git","bundle","create",str(history),"HEAD","--branches","--tags"],cwd=ROOT,check=True)
        shutil.copyfile(archive,dest)
        with ZipFile(dest,"a",compression=ZIP_DEFLATED) as z:z.write(history,"historico.bundle")

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--archive",type=Path);args=parser.parse_args()
    out=args.out.resolve()
    if out==ROOT or out==ROOT/"showcase":raise SystemExit("Use um diretório de saída dedicado.")
    out.mkdir(exist_ok=True,parents=True)
    for name in ["index.html","show.js","style.css"]:shutil.copyfile(ROOT/"showcase"/name,out/name)
    for name,src in [("media",ROOT/"docs/media"),("fonts",ROOT/"showcase/fonts")]:
        shutil.copytree(src,out/name,dirs_exist_ok=True)
    (out/"model").mkdir(exist_ok=True)
    for suffix in ["css","js"]:
        name="yard."+suffix;shutil.copyfile(ROOT/"doca-norte/web/src"/name,out/"model"/name)
    (out/"case").mkdir(exist_ok=True)
    for key,(title,question,decision,evidence,limit,source,cmd) in CASES.items():
        page=f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · Caderno aplicado</title><link rel="stylesheet" href="../style.css"></head>
        <body><header class="top"><div class="bar wrap"><a class="wordmark" href="../index.html">Victor <i>Almeida</i></a><a href="../index.html#{key}">Voltar à demonstração ↗</a></div></header>
        <main class="article"><p class="overline">ESTUDO DE CASO</p><h1>{title}</h1><h2>{question}</h2><p>{decision}</p>
        <img src="../media/{key}.webp" alt="Interface real do {title}"><h2>O que o teste mostrou</h2><p>{evidence}</p><p>{limit}</p><h2>Rodar localmente</h2><p>Extraia o código e execute na pasta que contém <code>compose.yaml</code>.</p><pre>{html.escape(cmd)}</pre><p>Entrada de código para sua leitura:</p><pre>{html.escape(source)}</pre>
        <a href="../caderno-aplicado.zip" download>Baixar o código e o histórico Git ↓</a></main></body></html>"""
        (out/"case"/(key+".html")).write_text(page,encoding="utf-8")
    if args.archive:shutil.copyfile(args.archive,out/"caderno-aplicado.zip")
    else:bundle(out/"caderno-aplicado.zip")

if __name__=="__main__":main()
