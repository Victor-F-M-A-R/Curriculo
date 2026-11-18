"""Edit validated Chromium captures into silent, captioned MP4 case studies.

Dependencies: Python 3.10+, Pillow, FFmpeg with libx264 and DejaVu fonts.
Input is the output of capture.mjs. Durations are editorial; photographs and
screen sequences come from the running product.
"""
import argparse
import json
import os
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

BASE = Path(__file__).resolve().parent
CASES = json.loads((BASE / "cases.json").read_text(encoding="utf-8"))
W, H = 1440, 810
FPS = 8
DURATIONS = [4, 6, 6, 6, 5]
DARK, PAPER, MUTED = "#13221F", "#F6F5EA", "#BFCBC1"
LANCZOS = Image.Resampling.LANCZOS


@lru_cache(maxsize=64)
def font(size, style="sans"):
    files = {"sans": "DejaVuSans.ttf", "bold": "DejaVuSans-Bold.ttf",
             "serif": "DejaVuSerif.ttf", "mono": "DejaVuSansMono.ttf"}
    try:
        return ImageFont.truetype(files[style], size)
    except OSError:
        # Windows does not ship DejaVu. Use installed system fonts without
        # downloading or redistributing another font family.
        windows = {"sans": "arial.ttf", "bold": "arialbd.ttf",
                   "serif": "georgia.ttf", "mono": "consola.ttf"}
        directory = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
        return ImageFont.truetype(str(directory / windows[style]), size)


def wrap(draw, text, width, face):
    lines = []
    line = ""
    for word in text.split():
        candidate = (line + " " + word).strip()
        if line and draw.textlength(candidate, font=face) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def write_wrapped(draw, x, y, text, width, size, color, style="sans", leading=None):
    face = font(size, style)
    for line in wrap(draw, text, width, face):
        draw.text((x, y), line, font=face, fill=color, anchor="lt")
        y += leading or int(size * 1.37)
    return y


def slate(case, poster, end=False):
    art = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(art)
    accent = case["accent"]
    d.line((54, 80, W - 54, 80), fill="#4C6157", width=2)
    d.text((54, 43), "VICTOR ALMEIDA   /   PORTFÓLIO DE ENGENHARIA", font=font(16, "mono"), fill=MUTED, anchor="lt")
    d.text((W - 54, 43), "DADOS SINTÉTICOS", font=font(16, "mono"), fill=MUTED, anchor="rt")
    d.text((58, 180), case["category"].upper(), font=font(22, "mono"), fill=accent, anchor="lt")
    d.text((53, 241), "Resultado" if end else case["name"], font=font(87, "serif"), fill=PAPER, anchor="lt")
    write_wrapped(d, 58, 382, case["outcome"] if end else case["question"], 565, 37, PAPER, leading=51)
    fill = "#223630"
    d.rectangle((680, 145, W + 12, 638), fill=fill)
    photo = ImageOps.contain(poster, (684, 422), method=LANCZOS)
    px = 708
    py = 179 + (422 - photo.height)//2
    art.paste(photo, (px, py))
    d = ImageDraw.Draw(art)
    d.text((705, 604), "INTERFACE EM EXECUÇÃO", font=font(15, "mono"), fill=accent, anchor="lt")
    d.line((54, 681, W - 54, 681), fill="#4C6157", width=2)
    d.text((56, 713), case["stack"], font=font(23), fill=PAPER, anchor="lt")
    d.text((W - 54, 752), "github.com/Victor-F-M-A-R/Curriculo", font=font(16, "mono"), fill=MUTED, anchor="rt")
    return art


def stage_base(case, stage):
    label, title, detail = case["scenes"][stage]
    art = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(art)
    d.text((40, 14), case["name"] + "   /   " + case["category"], font=font(19, "bold"), fill=PAPER, anchor="lt")
    d.text((W - 40, 16), label.upper(), font=font(17, "mono"), fill=case["accent"], anchor="rt")
    d.line((40, 48, W - 40, 48), fill="#53645B", width=1)
    d.text((40, 715), title, fill=PAPER, font=font(29, "bold"), anchor="lt")
    d.text((40, 760), detail, fill=MUTED, font=font(21), anchor="lt")
    return art


def overview(pic, width, path):
    scaled = pic.copy()
    scaled.thumbnail((width, width * 2), LANCZOS)
    scaled.save(path, "WEBP", quality=88, method=6)


def timestamp(seconds):
    return f"00:{seconds // 60:02}:{seconds % 60:02}.000"


def write_track(path, lines):
    elapsed = 0
    cues = ["WEBVTT", ""]
    for duration, text in zip(DURATIONS, lines, strict=True):
        cues.extend([f"{timestamp(elapsed)} --> {timestamp(elapsed + duration)}", text, ""])
        elapsed += duration
    path.write_text("\n".join(cues).rstrip() + "\n", encoding="utf-8")


def verify_stream(path):
    data = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]
    ))
    stream = next(s for s in data["streams"] if s["codec_type"] == "video")
    assert (stream["codec_name"], stream["width"], stream["height"], stream["pix_fmt"]) == ("h264", W, H, "yuv420p")
    assert any(s["codec_type"] == "subtitle" and s.get("tags", {}).get("language") == "por" for s in data["streams"])
    assert abs(float(data["format"]["duration"]) - sum(DURATIONS)) < .1


def render(key, source, destination):
    case = CASES[key]
    capture = source / key
    manifest = json.loads((capture / "manifest.json").read_text(encoding="utf-8"))
    if manifest != {"project": key, "source": "chromium", "phases": ["A", "B", "C"]}:
        raise ValueError("A captura precisa ser validada pelo roteiro do Chromium.")
    scenes = [sorted((capture / phase).glob("*.jpg")) for phase in manifest["phases"]]
    if any(len(files) < 2 for files in scenes):
        raise ValueError(f"Captura incompleta para {key}.")
    poster = Image.open(capture / "poster.png").convert("RGB")
    overview(poster, 1360, destination / f"{key}.webp")
    with Image.open(capture / "mobile.png") as screen:
        overview(screen.convert("RGB"), 390, destination / f"{key}-mobile.webp")
    pt = [case["question"], *[" ".join(scene[1:]) for scene in case["scenes"]], case["outcome"]]
    tracks = [(destination / f"{key}.vtt", "por", pt)]
    if "english" in case:
        tracks.append((destination / f"{key}.en.vtt", "eng", case["english"]))
    with tempfile.TemporaryDirectory() as work:
        raw = Path(work) / "video.mp4"
        encoder = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                    "-s", f"{W}x{H}", "-framerate", str(FPS), "-i", "pipe:0",
                                    "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
                                    "-crf", "20", "-threads", "2", str(raw)], stdin=subprocess.PIPE)
        def hold(frame, seconds):
            pixels = frame.tobytes()
            for _ in range(seconds * FPS):
                encoder.stdin.write(pixels)
        try:
            hold(slate(case, poster), DURATIONS[0])
            for idx, files in enumerate(scenes):
                base = stage_base(case, idx)
                length = FPS * DURATIONS[idx + 1]
                previous, pixels = -1, None
                for frame in range(length):
                    position = round(frame * (len(files)-1)/(length-1))
                    if previous != position:
                        with Image.open(files[position]) as photo:
                            screen = ImageOps.contain(photo.convert("RGB"), (1360, 642), method=LANCZOS)
                        art = base.copy()
                        art.paste(screen, ((W-screen.width)//2, 56+(642-screen.height)//2))
                        pixels = art.tobytes()
                        previous = position
                    encoder.stdin.write(pixels)
            with Image.open(scenes[-1][-1]) as photo:
                hold(slate(case, photo.convert("RGB"), end=True), DURATIONS[-1])
        finally:
            encoder.stdin.close()
            status = encoder.wait()
        if status:
            raise RuntimeError(f"Falha na codificação de {key}: {status}")
        command = ["ffmpeg", "-v", "error", "-y", "-i", str(raw)]
        for track, _, cues in tracks:
            write_track(track, cues)
            command.extend(["-i", str(track)])
        command.extend(["-map", "0:v:0"])
        for i, (_, lang, _) in enumerate(tracks):
            command.extend(["-map", f"{i+1}:0", f"-metadata:s:s:{i}", f"language={lang}"])
        target = destination / f"{key}.mp4"
        command.extend(["-c:v", "copy", "-c:s", "mov_text", "-disposition:s", "0",
                        "-metadata", "title=" + case["name"] + " | Victor Almeida", "-movflags", "+faststart", str(target)])
        subprocess.run(command, check=True)
        verify_stream(target)
        # A compact preview keeps the Markdown usable where embedded MP4 is unavailable.
        filt = "fps=4,scale=544:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=72[p];[b][p]paletteuse=dither=bayer"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "4", "-t", "6", "-i", str(raw),
                        "-filter_complex_threads", "1", "-filter_complex", filt, "-loop", "0",
                        str(destination / f"{key}-demo.gif")], check=True)
    print(f"{key}: {sum(DURATIONS)} s, {W} × {H}, legenda incorporada", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Diretório produzido por capture.mjs")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--only", action="append", choices=CASES)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for key in args.only or CASES:
        render(key, args.input, args.out)


if __name__ == "__main__":
    main()
