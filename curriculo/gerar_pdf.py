"""Gera o PDF de uma página a partir do currículo em texto. Requer ReportLab."""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab import __file__ as reportlab_path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate


BASE = Path(__file__).resolve().parent
SOURCE = BASE / "Victor_Almeida_Curriculo_ATS.txt"
OUTPUT = BASE / "Victor_Almeida_Curriculo.pdf"
SECTIONS = {"Perfil profissional", "Experiência", "Projetos pessoais", "Outros trabalhos com IA", "Formação e idiomas"}
PROJECTS = {"Farol": "farol", "Rastro": "rastro", "Lastro": "lastro", "Doca Norte": "doca-norte"}
INK = "#182D29"
ACCENT = "#165749"
SECONDARY = "#3A4F49"
FONT_DIR = Path(reportlab_path).parent / "fonts"
pdfmetrics.registerFont(TTFont("CVSans", str(FONT_DIR / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("CVSansBold", str(FONT_DIR / "VeraBd.ttf")))


def style(key, size, leading, font="CVSans", color=INK, before=0, after=0):
    return ParagraphStyle(key, fontName=font, fontSize=size, leading=leading,
                          textColor=colors.HexColor(color), alignment=TA_LEFT,
                          spaceBefore=before, spaceAfter=after, splitLongWords=False)


NAME = style("nome", 24.8, 30, font="CVSansBold", after=2)
FOCUS = style("foco", 13.4, 18, font="CVSansBold", color=ACCENT, after=3)
CONTACT = style("contato", 9.4, 13, color=SECONDARY)
SECTION = style("secao", 12.5, 17, font="CVSansBold", color=ACCENT, before=9, after=2)
POSITION = style("atividade", 10, 13.7, font="CVSansBold", before=5, after=1)
BODY = style("texto", 9.85, 14.1, after=2.5)


def linked(text, url):
    return f'<link href="{escape(url)}" color="{ACCENT}" underline="1">{escape(text)}</link>'


def generate():
    blocks = SOURCE.read_text(encoding="utf-8").strip().split("\n\n")
    name, focus, location_and_email, portfolio = blocks[0].splitlines()
    location, email = location_and_email.split(" | ", 1)
    flow = [
        Paragraph(escape(name), NAME),
        Paragraph(escape(focus), FOCUS),
        Paragraph(escape(location) + " | " + linked(email, "mailto:" + email), CONTACT),
        Paragraph(linked(portfolio, portfolio), CONTACT),
    ]
    for block in blocks[1:]:
        title, *lines = block.splitlines()
        if title in SECTIONS:
            flow.append(Paragraph(escape(title), SECTION))
        else:
            label, _, tools = title.partition(" | ")
            if label in PROJECTS:
                url = f"{portfolio}/tree/main/portfolio/{PROJECTS[label]}"
                heading = linked(label, url) + f' <font name="CVSans">| {escape(tools)}</font>'
            else:
                heading = escape(title)
            flow.append(Paragraph(heading, POSITION))
        flow.extend(Paragraph(escape(line), BODY) for line in lines)

    def decorate(page, _):
        if page.getPageNumber() > 1:
            raise ValueError("O texto excedeu uma página A4. Revise o conteúdo ou o layout.")
        width, height = A4
        page.setTitle("Currículo de " + name)
        page.setAuthor(name)
        page.setSubject(focus)
        page.setFillColor(colors.HexColor(ACCENT))
        page.rect(0, height - 5, width, 5, fill=1, stroke=0)

    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=37, rightMargin=37,
                            topMargin=30, bottomMargin=28, title="Currículo de " + name,
                            author=name, subject=focus)
    doc.build(flow, onFirstPage=decorate, onLaterPages=decorate)


if __name__ == "__main__":
    generate()
