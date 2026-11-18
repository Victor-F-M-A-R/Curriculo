"""Build the self-contained portfolio gallery from a Git checkout (Python 3.10+)."""
import argparse
import html
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SHOWCASE = ROOT / "showcase"
CASES = json.loads((SHOWCASE / "cases.json").read_text(encoding="utf-8"))
REPO = "https://github.com/Victor-F-M-A-R/Curriculo"
CV = ("Victor_Almeida_Curriculo.pdf", "Victor_Almeida_Curriculo_ATS.txt")


def bundle(destination):
    repository = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True).strip()
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip()
    with tempfile.TemporaryDirectory() as folder:
        archive = Path(folder) / "source.zip"
        history = Path(folder) / "historico.bundle"
        subprocess.run(["git", "archive", "--format=zip", "-o", str(archive), "HEAD"], cwd=repository, check=True)
        subprocess.run(["git", "bundle", "create", str(history), "HEAD"], cwd=repository, check=True)
        shutil.copyfile(archive, destination)
        with ZipFile(destination, "a", compression=ZIP_DEFLATED) as package:
            package.write(history, "historico.bundle")
            package.writestr("VERSAO-DO-PACOTE.txt", f"Repositório: {REPO}\nCommit: {revision}\n"
                             "O código deste pacote corresponde ao commit acima.\n"
                             "O arquivo historico.bundle preserva o histórico Git desse commit.\n")


def build_home():
    page = (SHOWCASE / "index.html").read_text(encoding="utf-8")
    links = []
    metadata = {}
    for slug, c in CASES.items():
        current = ' aria-current="true"' if slug == "doca" else ""
        links.append(f'<a href="case/{slug}.html" data-project="{slug}"{current}>'
                     f'{html.escape(c["name"])} <small>{html.escape(c["label"])}</small></a>')
        metadata[slug] = {field: c[field] for field in ("name", "category", "brief", "stack", "project")}
        metadata[slug]["english"] = "english" in c
    payload = json.dumps(metadata, ensure_ascii=False).replace("<", "\\u003c")
    return page.replace("<!-- PROJECT_LINKS -->", "\n".join(links)).replace("<!-- CASE_DATA -->", payload)


def build_case(slug, case):
    esc = html.escape
    name = esc(case["name"])
    labels = [(0, "Escopo", case["question"])]
    labels.extend((start, part[0], " ".join(part[1:])) for start, part in zip([4, 10, 16], case["scenes"], strict=True))
    labels.append((22, "Resultado", case["outcome"]))
    transcript = "\n".join(f"<dt>0:{start:02} · {esc(label)}</dt><dd>{esc(description)}</dd>" for start, label, description in labels)
    english = f'<track kind="captions" srclang="en" label="English" src="../media/{slug}.en.vtt" />' if "english" in case else ""
    return f'''<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="description" content="{esc(case["brief"], quote=True)}" />
<title>{name} · Estudo de caso de Victor Almeida</title><link rel="stylesheet" href="../style.css" />
</head><body>
<a href="#estudo" class="skip">Pular para o estudo</a>
<header class="top"><div class="bar wrap"><a class="wordmark" href="../index.html">Victor <i>Almeida</i></a>
<nav aria-label="Navegação"><a href="../index.html#{slug}">Projetos</a><a href="../curriculo/{CV[0]}">Currículo PDF</a></nav></div></header>
<main class="article" id="estudo">
<p class="overline">{esc(case["category"])}</p><h1>{name}</h1>
<p class="question">{esc(case["question"])}</p>
<p class="project-stack">{esc(case["stack"])}</p>
<video controls playsinline preload="none" poster="../media/{slug}.webp" aria-label="Demonstração de {name}">
<source src="../media/{slug}.mp4" type="video/mp4" /><track kind="captions" srclang="pt-BR" label="Português" src="../media/{slug}.vtt" />{english}
Seu navegador não reproduz este vídeo. A transcrição e o link para baixar o MP4 estão disponíveis nesta página.
</video>
<details class="transcript"><summary>Ler a transcrição do vídeo</summary><dl>{transcript}</dl></details>
<h2>O problema e a solução</h2><p>{esc(case["brief"])}</p><p>{esc(case["decision"])}</p>
<h2>Como verificar</h2><p>{esc(case["evidence"])}</p><p>{esc(case["limit"])}</p>
<div class="resource-links"><a href="{REPO}/blob/main/portfolio/{case["path"]}">{esc(case["action"])}</a><a href="{REPO}/tree/main/portfolio/{case["project"]}">Código e documentação</a></div>
<h2>Executar localmente</h2><p>Na pasta <code>portfolio</code> do repositório, inicie os serviços com Docker Compose.</p>
<pre>{esc(case["cmd"])}</pre><p>Abra <code>http://localhost:{case["port"]}</code>.</p>
<div class="resource-links"><a href="../media/{slug}.mp4" download>Baixar MP4</a><a href="../media/{slug}-mobile.webp">Ver no celular</a><a href="../caderno-aplicado.zip" download>Baixar os quatro projetos e o histórico Git</a></div>
<p class="portfolio-note">Projeto pessoal com dados fictícios e implementação assistida por IA.</p>
</main></body></html>'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--archive", type=Path, help="Use um pacote de código já construído.")
    args = parser.parse_args()
    out = args.out.resolve()
    if out in {ROOT, SHOWCASE, ROOT.parent}:
        raise SystemExit("Use um diretório de saída dedicado.")
    out.mkdir(exist_ok=True, parents=True)
    (out / "index.html").write_text(build_home(), encoding="utf-8")
    for name in ("show.js", "style.css"):
        shutil.copyfile(SHOWCASE / name, out / name)
    for name, source in [("media", ROOT / "docs/media"), ("fonts", SHOWCASE / "fonts")]:
        shutil.copytree(source, out / name, dirs_exist_ok=True)
    for folder in ("case", "model", "curriculo"):
        (out / folder).mkdir(exist_ok=True)
    for suffix in ("css", "js"):
        name = "yard." + suffix
        shutil.copyfile(ROOT / "doca-norte/web/src" / name, out / "model" / name)
    for name in CV:
        shutil.copyfile(ROOT.parent / "curriculo" / name, out / "curriculo" / name)
    for slug, case in CASES.items():
        (out / "case" / f"{slug}.html").write_text(build_case(slug, case), encoding="utf-8")
    target = out / "caderno-aplicado.zip"
    if args.archive:
        shutil.copyfile(args.archive, target)
    else:
        bundle(target)


if __name__ == "__main__":
    main()
