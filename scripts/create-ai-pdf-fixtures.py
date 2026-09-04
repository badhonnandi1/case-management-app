from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).parent / "fixtures" / "pdfs"
BANGLA_FONT = "/System/Library/Fonts/Supplemental/Bangla MN.ttc"


def text_pdf(path: Path, lines: list[str], font_name: str = "Helvetica") -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setTitle("Synthetic non-confidential AI indexing fixture")
    pdf.setFont(font_name, 14)
    y = A4[1] - 72
    for line in lines:
        pdf.drawString(72, y, line)
        y -= 24
    pdf.showPage()
    pdf.save()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("BanglaFixture", BANGLA_FONT, subfontIndex=0))
    text_pdf(
        OUTPUT / "digital-english.pdf",
        ["Case 42/2026", "Hearing date: 15 September 2026", "Order: Arguments scheduled."],
    )
    text_pdf(
        OUTPUT / "digital-bangla.pdf",
        ["মামলা নম্বর ৪২/২০২৬", "শুনানির তারিখ ১৫ সেপ্টেম্বর ২০২৬", "আদেশ: পরবর্তী শুনানি।"],
        "BanglaFixture",
    )
    text_pdf(
        OUTPUT / "digital-mixed.pdf",
        ["LST 45/22 - রহিমা বনাম করিম", "Court: সদর আদালত", "Next step: চূড়ান্ত শুনানি"],
        "BanglaFixture",
    )

    blank = canvas.Canvas(str(OUTPUT / "empty-scanned-like.pdf"), pagesize=A4, pageCompression=1)
    blank.rect(72, A4[1] - 300, 300, 160, stroke=1, fill=0)
    blank.showPage()
    blank.save()

    (OUTPUT / "corrupted.pdf").write_bytes(b"%PDF-1.7\nsynthetic corrupted fixture\n")


if __name__ == "__main__":
    main()
