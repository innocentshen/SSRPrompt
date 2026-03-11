import argparse
import base64
import io
import json
import sys


def render_with_fitz(pdf_bytes: bytes, dpi: int):
    import fitz

    scale = max(dpi, 72) / 72.0
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []

    try:
        for index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            png_bytes = pixmap.tobytes("png")
            images.append(
                {
                    "pageNumber": index,
                    "mimeType": "image/png",
                    "width": pixmap.width,
                    "height": pixmap.height,
                    "dataBase64": base64.b64encode(png_bytes).decode("ascii"),
                }
            )
    finally:
        document.close()

    return {"engine": "fitz", "images": images}


def render_with_pdfium(pdf_bytes: bytes, dpi: int):
    import pypdfium2 as pdfium

    scale = max(dpi, 72) / 72.0
    document = pdfium.PdfDocument(pdf_bytes)
    images = []

    try:
        for index in range(len(document)):
            page = document[index]
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil()
            buffer = io.BytesIO()
            pil_image.save(buffer, format="PNG")
            png_bytes = buffer.getvalue()
            images.append(
                {
                    "pageNumber": index + 1,
                    "mimeType": "image/png",
                    "width": pil_image.width,
                    "height": pil_image.height,
                    "dataBase64": base64.b64encode(png_bytes).decode("ascii"),
                }
            )
    finally:
        document.close()

    return {"engine": "pypdfium2", "images": images}


def main():
    parser = argparse.ArgumentParser(description="Convert a PDF from stdin to PNG page images.")
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args()

    pdf_bytes = sys.stdin.buffer.read()
    if not pdf_bytes:
        raise RuntimeError("No PDF bytes received on stdin")

    renderer_errors = []
    for renderer in (render_with_fitz, render_with_pdfium):
        try:
            result = renderer(pdf_bytes, args.dpi)
            print(json.dumps(result, ensure_ascii=True))
            return
        except Exception as exc:  # pragma: no cover - fallback path
            renderer_errors.append(f"{renderer.__name__}: {exc}")

    raise RuntimeError(" ; ".join(renderer_errors) or "No PDF renderer is available")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
