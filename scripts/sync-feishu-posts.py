#!/usr/bin/env python3
"""Convert fetched Feishu wiki markdown JSON into Astro blog posts."""

import json
import re
import sys
from pathlib import Path

try:
    from urllib.request import Request, urlopen
except ImportError:
    from urllib2 import Request, urlopen  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
SRC_JSON = Path("/tmp/feishu-sync")
BLOG = ROOT / "src" / "content" / "blog"
PUBLIC = ROOT / "public" / "blog"
IMAGES_SRC = ROOT / "scripts" / "images-src" / "blog"

# Post metadata lives outside version control: real node tokens are kept in
# feishu-posts.local.json (gitignored); only the placeholder example is committed.
def load_posts():
    for candidate in ("feishu-posts.local.json", "feishu-posts.example.json"):
        path = Path(__file__).resolve().parent / candidate
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError("feishu-posts.local.json or feishu-posts.example.json is required")


POSTS = load_posts()

# Alt text from Feishu may contain ']' (e.g. Correctness\[GEval\]), so use non-greedy match.
IMG_RE = re.compile(r"!\[(.*?)\]\((https?://[^)]+)\)", re.S)
GRID_RE = re.compile(r"</?(?:grid|column)(?:\s[^>]*)?>", re.I)
BR_RE = re.compile(r"<br\s*/?>", re.I)


def normalize_cjk(text: str) -> str:
    """Map common CJK compatibility ideographs to unified forms."""
    # Feishu export sometimes emits Kangxi radicals / compat chars.
    table = str.maketrans(
        {
            "\u2f00": "一",
            "\u2f08": "人",
            "\u2f2f": "大",
            "\u2f3c": "小",
            "\u2f45": "工",
            "\u2f64": "文",
            "\u2f8e": "方",
            "\u2f94": "日",
            "\u2fa7": "月",
            "\u2f00": "一",
            "⼀": "一",
            "⼈": "人",
            "⼤": "大",
            "⼩": "小",
            "⼯": "工",
            "⽂": "文",
            "⽅": "方",
            "⽇": "日",
            "⽉": "月",
            "⽅": "方",
            "⽤": "用",
            "⽽": "而",
            "⾄": "至",
            "⾏": "行",
            "⾃": "自",
            "⾦": "金",
            "⾮": "非",
            "⾯": "面",
            "⾼": "高",
            "⿊": "黑",
            "⽅": "方",
            "⽅": "方",
        }
    )
    return text.translate(table)


def guess_ext(url, content_type):
    ct = (content_type or "").split(";")[0].strip().lower()
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    if ct in mapping:
        return mapping[ct]
    for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        if ext in url.lower():
            return ".jpg" if ext == ".jpeg" else ext
    return ".png"


def download_image(url, dest):
    """Return the actual saved path, or None when no new image was downloaded."""
    try:
        req = Request(url, headers={"User-Agent": "byte-cloud-sync/1.0"})
        with urlopen(req, timeout=60) as resp:
            data = resp.read()
            if len(data) < 100:
                return None
            ext = guess_ext(url, resp.headers.get("Content-Type"))
            if dest.suffix != ext:
                dest = dest.with_suffix(ext)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return dest
    except Exception as e:
        print("  image download failed:", type(e).__name__, file=sys.stderr)
        return None


def sentence_end(text, pos):
    """Return a conservative sentence boundary, including closing punctuation."""
    end = pos + 1
    closers = "\"')]}》】」』”’"
    while end < len(text) and text[end] in closers:
        end += 1
    if text[pos] == ".":
        previous = text[pos - 1] if pos else ""
        following = text[pos + 1] if pos + 1 < len(text) else ""
        if previous.isdigit() and following.isdigit():
            return None
        if end < len(text) and not text[end].isspace():
            return None
        word = re.search(r"([A-Za-z]+)$", text[:pos])
        if word and (
            len(word.group(1)) == 1
            or word.group(1).lower() in {"etc", "vs", "dr", "mr", "mrs", "ms", "prof", "fig", "eq", "no"}
        ):
            return None
    return end


def extract_description(body, limit=120):
    # Build the first usable prose paragraph before considering its sentence boundaries.
    for block in re.split(r"\n\s*\n", body):
        lines = []
        for line in block.splitlines():
            s = line.strip()
            if not s or s.startswith("#") or s.startswith("![") or s.startswith("|") or s.startswith("<"):
                continue
            lines.append(s)
        s = " ".join(lines)
        s = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", s)
        s = re.sub(r"[*_`]+", "", s)
        s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
        s = re.sub(r"</?[^>]+>", "", s)
        s = re.sub(r"\s+", " ", s).strip()
        if len(s) < 20:
            continue
        if len(s) <= limit:
            return s
        boundary = 0
        for pos, char in enumerate(s):
            if pos >= limit:
                break
            if char not in "。！？.!?":
                continue
            end = sentence_end(s, pos)
            if end is not None and end <= limit:
                boundary = end
        # A soft limit is preferable to a partial word or an incomplete sentence.
        return s[:boundary].rstrip() if boundary else s
    return "来自飞书知识库的同步文章。"


def escape_markdown_alt(text):
    return text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def escape_markdown_title(text):
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    # Numeric entities preserve line breaks without breaking the inline image syntax.
    return escaped.replace("\r\n", "&#10;").replace("\r", "&#10;").replace("\n", "&#10;")


def markdown_image(alt, url, caption=None):
    title = f' "{escape_markdown_title(caption)}"' if caption else ""
    return f"![{escape_markdown_alt(alt)}]({url}{title})"


def clean_body(body, slug):
    body = GRID_RE.sub("", body)
    body = BR_RE.sub("\n", body)
    body = normalize_cjk(body)

    metadata_path = IMAGES_SRC / slug / "images.json"
    try:
        image_meta = json.loads(metadata_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        image_meta = None
    if image_meta is not None and not isinstance(image_meta, list):
        raise ValueError(f"{slug}: {metadata_path} must contain an array")

    matches = list(IMG_RE.finditer(body))
    if image_meta is not None and len(image_meta) != len(matches):
        raise ValueError(
            f"{slug}: image count mismatch: Markdown has {len(matches)}, images.json has {len(image_meta)}"
        )

    img_dir = PUBLIC / slug
    img_dir.mkdir(parents=True, exist_ok=True)
    counter = {"n": 0}

    def repl(m):
        source_alt, url = m.group(1), m.group(2)
        counter["n"] += 1
        idx = counter["n"]
        item = image_meta[idx - 1] if image_meta is not None else None
        if item is not None and not isinstance(item, dict):
            raise ValueError(f"{slug}: images.json entry {idx} must be an object or null")

        if item is not None and "alt" in item:
            if not isinstance(item["alt"], str):
                raise ValueError(f"{slug}: images.json entry {idx} alt must be a string")
            alt = item["alt"]
        else:
            alt = source_alt
            print(
                f"  warning: {slug} image {idx:02d}: manual alt missing; keeping source alt",
                file=sys.stderr,
            )

        caption = item.get("caption") if item is not None else None
        if caption is not None and not isinstance(caption, str):
            raise ValueError(f"{slug}: images.json entry {idx} caption must be a string")

        filename = item.get("file") if item is not None else None
        if filename is not None and (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
            or filename in {".", "..", "images.json"}
        ):
            raise ValueError(f"{slug}: invalid images.json file for image {idx:02d}")
        dest = img_dir / (filename or f"{idx:02d}.png")
        downloaded = download_image(url, dest)
        if not downloaded:
            # Keep the selected alt and real caption, but never refresh from stale bytes.
            return markdown_image(alt, url, caption)
        saved = Path(downloaded) if isinstance(downloaded, (str, Path)) else dest
        if filename is not None and saved.name != filename:
            raise ValueError(
                f"{slug}: image {idx:02d} saved as {saved.name}, expected {filename} from images.json"
            )

        # The optimizer consumes masters, so update each one from the new public original.
        master = IMAGES_SRC / slug / saved.name
        master.parent.mkdir(parents=True, exist_ok=True)
        master.write_bytes(saved.read_bytes())
        rel = f"/blog/{slug}/{saved.name}"
        return markdown_image(alt, rel, caption)

    body = IMG_RE.sub(repl, body)
    # Collapse excess blank lines
    body = re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"
    return body


def extract_title_body(raw_content: str):
    m = re.search(r"<title>(.*?)</title>", raw_content, re.S)
    title = m.group(1).strip() if m else None
    body = re.sub(r"<title>.*?</title>\s*", "", raw_content, count=1, flags=re.S)
    return title, body


def yaml_escape(s: str) -> str:
    if any(c in s for c in ':#"\'[]{},&*?|>!%@`'):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def write_post(meta):
    data = json.loads((SRC_JSON / f"{meta['token']}.json").read_text(encoding="utf-8"))
    content = data["data"]["document"]["content"]
    title_from_doc, body = extract_title_body(content)
    title = meta["title"] or title_from_doc
    print(f"==> {meta['slug']}: {title}")
    body = clean_body(body, meta["slug"])
    desc = meta["description"] if "description" in meta else extract_description(body)
    tags = ", ".join(meta["tags"])
    fm = "\n".join(
        [
            "---",
            f"title: {yaml_escape(title)}",
            f"description: {yaml_escape(desc)}",
            f"pubDate: {meta['pubDate']}",
            f"updatedDate: {meta['updatedDate']}",
            f"tags: [{tags}]",
            f"featured: {'true' if meta.get('featured', False) else 'false'}",
            "---",
            "",
        ]
    )
    out = BLOG / f"{meta['slug']}.md"
    out.write_text(fm + body, encoding="utf-8")
    print(f"  wrote {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")
    return out


def main():
    BLOG.mkdir(parents=True, exist_ok=True)
    for meta in POSTS:
        write_post(meta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
