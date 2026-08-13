"""
Generate a fillable Website Hosting & Maintenance Agreement PDF for Business One.
Output: user's Downloads folder.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader, simpleSplit

# Brand colors — match Business One POS (css/pos.css)
BLUE = colors.HexColor("#1f82ff")
BLUE_LIGHT = colors.HexColor("#eef5ff")
ORANGE = colors.HexColor("#ff9b1f")
GRAY = colors.HexColor("#555555")
FIELD_BORDER = colors.HexColor("#bfdbfe")

PAGE_W, PAGE_H = letter
MARGIN = 0.55 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

PROVIDER_NAME = "Business One"
PROVIDER_EMAIL = "info@businessonecomprehensive.com"
PROVIDER_PHONE = "(850) 290-2084"
PROVIDER_WEBSITE = "https://businessonecomprehensive.com/"

# Four-tier managed hosting — keep aligned with business-one-webpage/HOSTING-PRICING.md
HOSTING_TIERS = [
    ("Essential", "$150/mo", "—", "Up to 15k visits or 40 GB"),
    ("Standard", "$300/mo", "$150/mo", "15k–50k visits or 41–100 GB"),
    ("Growth", "$450/mo", "$300/mo", "50k–150k visits or 101–250 GB"),
    ("Enterprise", "$600/mo", "$450/mo", "150k+ visits or 251 GB+"),
]

LOGO_PATH = Path(__file__).resolve().parent / "assets" / "business-one-logo.png"
OUTPUT_PATH = Path.home() / "Downloads" / "Website-Hosting-Maintenance-Agreement.pdf"


def draw_logo(c, x, y, height_inches=0.55):
    """Draw the Business One 1B logo from POS assets."""
    img = ImageReader(str(LOGO_PATH))
    iw, ih = img.getSize()
    h = height_inches * inch
    w = h * (iw / ih)
    c.drawImage(img, x, y, width=w, height=h, mask="auto", preserveAspectRatio=True)
    return w


def draw_section_header(c, y, title, color=BLUE, height=22):
    c.setFillColor(color)
    c.rect(MARGIN, y - height + 6, CONTENT_W, height, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGIN + 8, y - height + 11, title)
    return y - height - 4


def draw_label(c, x, y, text, bold=False):
    c.setFillColor(GRAY)
    c.setFont("Helvetica-Bold" if bold else "Helvetica", 7.5)
    c.drawString(x, y, text)


def draw_field_bg(c, x, y, w, h=14):
    c.setFillColor(BLUE_LIGHT)
    c.setStrokeColor(FIELD_BORDER)
    c.setLineWidth(0.5)
    c.rect(x, y, w, h, fill=1, stroke=1)


def draw_footer(c):
    y = 0.42 * inch
    c.setStrokeColor(ORANGE)
    c.setLineWidth(1.5)
    c.line(MARGIN, y + 14, PAGE_W - MARGIN, y + 14)
    c.setFillColor(BLUE)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(MARGIN + CONTENT_W * 0.17, y, PROVIDER_WEBSITE)
    c.drawCentredString(MARGIN + CONTENT_W * 0.50, y, PROVIDER_PHONE)
    c.drawCentredString(MARGIN + CONTENT_W * 0.83, y, PROVIDER_EMAIL)


def draw_wrapped(c, x, y, w, text, size=7.2, leading=9.5, color=GRAY):
    c.setFillColor(color)
    c.setFont("Helvetica", size)
    lines = simpleSplit(text, "Helvetica", size, w)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_hosting_tiers(c, y):
    """Compact four-tier plan reference (e-commerce + legacy/principal rates)."""
    y = draw_section_header(c, y, "Hosting Plans (month-to-month)", color=ORANGE, height=20)
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 7)
    c.drawString(
        MARGIN,
        y - 10,
        "Select plan in Section 2. +$150/mo per tier step when traffic exceeds your band for 2 consecutive months.",
    )
    y -= 18
    col_w = [1.05 * inch, 0.85 * inch, 0.95 * inch, CONTENT_W - 1.05 * inch - 0.85 * inch - 0.95 * inch]
    headers = ["Plan", "Monthly", "Principal", "Traffic / bandwidth"]
    hx = MARGIN
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 7)
    for i, h in enumerate(headers):
        c.drawString(hx + 3, y, h)
        hx += col_w[i]
    y -= 12
    c.setFont("Helvetica", 6.8)
    for plan, eco, legacy, limits in HOSTING_TIERS:
        hx = MARGIN
        c.setFillColor(BLUE_LIGHT)
        c.rect(MARGIN, y - 11, CONTENT_W, 13, fill=1, stroke=0)
        for i, cell in enumerate([plan, eco, legacy, limits]):
            c.setFillColor(GRAY)
            c.drawString(hx + 3, y - 8, cell)
            hx += col_w[i]
        y -= 14
    return y - 4


def draw_bullet_block(c, x, y, w, items, size=7.2, leading=10):
    c.setFillColor(GRAY)
    c.setFont("Helvetica", size)
    for item in items:
        lines = simpleSplit(item, "Helvetica", size, w - 12)
        c.drawString(x, y, "\u2022")
        for i, line in enumerate(lines):
            c.drawString(x + 10, y - i * leading, line)
        y -= leading * len(lines) + 2
    return y


def add_text_field(form, name, x, y, w, h=14, multiline=False):
    form.textfield(
        name=name,
        tooltip=name,
        x=x,
        y=y,
        width=w,
        height=h,
        borderStyle="inset",
        borderWidth=0,
        forceBorder=False,
        fillColor=BLUE_LIGHT,
        textColor=colors.black,
        fontSize=8,
        fieldFlags="multiline" if multiline else "",
    )


def add_checkbox(form, name, x, y, size=11):
    form.checkbox(
        name=name,
        tooltip=name,
        x=x,
        y=y,
        buttonStyle="check",
        size=size,
        borderWidth=1,
        borderColor=ORANGE,
        fillColor=colors.white,
        textColor=ORANGE,
        forceBorder=True,
    )


def page1(c, form):
    y = PAGE_H - MARGIN

    logo_w = draw_logo(c, MARGIN, y - 0.5 * inch, 0.5)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN + logo_w + 0.12 * inch, y - 0.18 * inch, "WEBSITE HOSTING & MAINTENANCE AGREEMENT")
    c.setStrokeColor(ORANGE)
    c.setLineWidth(2)
    c.line(MARGIN, y - 0.58 * inch, PAGE_W - MARGIN, y - 0.58 * inch)
    y -= 0.72 * inch

    intro = (
        'This Website Hosting & Maintenance Agreement ("Agreement") is entered into between '
        f'{PROVIDER_NAME} ("Provider") and the undersigned client ("Client"). '
        "This is a month-to-month service agreement, not a long-term lock-in contract. "
        "Client agrees to pay the rates shown below for as long as Client continues to use Provider's services. "
        "There is no minimum commitment period and no early termination fees."
    )
    y = draw_wrapped(c, MARGIN, y, CONTENT_W, intro, size=7.5, leading=10) - 6
    y = draw_hosting_tiers(c, y)

    y = draw_section_header(c, y, "1. Client & Business Information")
    col_w = (CONTENT_W - 16) / 2
    left_x = MARGIN
    right_x = MARGIN + col_w + 16
    field_y = y - 12

    draw_label(c, left_x, field_y, "Client Information", bold=True)
    draw_label(c, right_x, field_y, f"{PROVIDER_NAME} (Provider)", bold=True)
    field_y -= 14

    client_fields = [
        ("client_name", "Client Name:"),
        ("client_email", "Email:"),
        ("client_phone", "Phone:"),
        ("client_billing_address", "Billing Address:"),
        ("client_city_state_zip", "City, State, ZIP:"),
    ]
    for fname, label in client_fields:
        draw_label(c, left_x, field_y, label)
        draw_field_bg(c, left_x, field_y - 16, col_w)
        add_text_field(form, fname, left_x + 1, field_y - 15, col_w - 2)
        field_y -= 28

    provider_static = [
        ("Business Name:", PROVIDER_NAME),
        ("Email:", PROVIDER_EMAIL),
        ("Phone:", PROVIDER_PHONE),
    ]
    prov_y = y - 26
    for label, value in provider_static:
        draw_label(c, right_x, prov_y, label)
        draw_field_bg(c, right_x, prov_y - 16, col_w)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        c.drawString(right_x + 4, prov_y - 12, value)
        prov_y -= 28

    y = min(field_y, prov_y) - 4
    y = draw_section_header(c, y, "2. Website & Service Details")

    field_y = y - 12
    left_fields = [
        ("website_domain", "Website Domain:"),
        ("monthly_fee", "Monthly Fee:"),
        ("effective_date", "Effective Date:"),
    ]
    right_fields = [
        ("hosting_plan", "Hosting Plan:"),
        ("billing_cycle", "Billing Cycle:"),
    ]

    for fname, label in left_fields:
        draw_label(c, left_x, field_y, label)
        draw_field_bg(c, left_x, field_y - 16, col_w)
        fx = left_x + 1
        fw = col_w - 2
        if fname == "monthly_fee":
            c.setFillColor(GRAY)
            c.setFont("Helvetica", 8)
            c.drawString(left_x + 4, field_y - 12, "$")
            fx = left_x + 12
            fw = col_w - 14
        add_text_field(form, fname, fx, field_y - 15, fw)
        field_y -= 28

    right_y = y - 12
    for fname, label in right_fields:
        draw_label(c, right_x, right_y, label)
        draw_field_bg(c, right_x, right_y - 16, col_w)
        add_text_field(form, fname, right_x + 1, right_y - 15, col_w - 2)
        right_y -= 28

    draw_label(c, right_x, right_y, "Initial Contract Term:")
    right_y -= 14
    add_checkbox(form, "term_month_to_month", right_x, right_y - 2)
    c.setFillColor(GRAY)
    c.setFont("Helvetica", 7.5)
    c.drawString(right_x + 14, right_y, "Month-to-Month")

    other_x = right_x + 110
    add_checkbox(form, "term_other", other_x, right_y - 2)
    c.drawString(other_x + 14, right_y, "Other:")
    draw_field_bg(c, other_x + 42, right_y - 4, col_w - (other_x - right_x) - 42, h=12)
    add_text_field(form, "term_other_text", other_x + 43, right_y - 3, col_w - (other_x - right_x) - 44, h=11)

    y = min(field_y, right_y) - 10
    y = draw_section_header(c, y, "3. Service Summary & Inclusions", color=ORANGE)

    c.setFillColor(GRAY)
    c.setFont("Helvetica", 7.5)
    c.drawString(
        MARGIN,
        y - 10,
        f"{PROVIDER_NAME} will provide the following hosting and maintenance services (as selected in your plan):",
    )
    y -= 22

    services = [
        "Website Hosting",
        "Daily/Weekly Backups",
        "Uptime Monitoring",
        "Domain Management (if applicable)",
        "Security Monitoring",
        "Technical Support",
        "SSL Certificate",
        "Website Maintenance (Updates & Upkeep)",
        "Other Services as Agreed",
    ]
    cols = 3
    col_width = CONTENT_W / cols
    row_h = 20
    start_y = y
    for i, label in enumerate(services):
        col = i % cols
        row = i // cols
        sx = MARGIN + col * col_width
        sy = start_y - row * row_h
        c.setFillColor(ORANGE)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(sx, sy, "\u2022")
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 7.2)
        c.drawString(sx + 10, sy, label)

    y = start_y - 3 * row_h - 6
    draw_label(c, MARGIN, y, "Special Terms / Notes:")
    draw_field_bg(c, MARGIN, y - 52, CONTENT_W, h=48)
    add_text_field(form, "special_terms", MARGIN + 2, y - 50, CONTENT_W - 4, h=46, multiline=True)

    draw_footer(c)
    c.showPage()


def page2(c, form):
    y = PAGE_H - MARGIN

    logo_w = draw_logo(c, MARGIN, y - 0.38 * inch, 0.38)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN + logo_w + 0.1 * inch, y - 0.16 * inch, "WEBSITE HOSTING & MAINTENANCE AGREEMENT")
    c.setStrokeColor(ORANGE)
    c.setLineWidth(1.5)
    c.line(MARGIN, y - 0.45 * inch, PAGE_W - MARGIN, y - 0.45 * inch)
    y -= 0.58 * inch

    y = draw_section_header(c, y, "4. Terms & Conditions")

    terms = [
        (
            "Services",
            "Provider agrees to furnish website hosting and maintenance services as described in this Agreement "
            "and the selected service plan. Services may include hosting infrastructure, backups, monitoring, "
            "security updates, and technical support during normal business hours unless otherwise agreed in writing.",
        ),
        (
            "Domain Ownership",
            "Client retains ownership of their domain name(s). Provider may assist with DNS configuration and "
            "renewal coordination when authorized. Client is responsible for maintaining domain registration "
            "and ensuring accurate registrant contact information.",
        ),
        (
            "SSL & Security",
            "Provider will implement reasonable security measures including SSL certificate installation and "
            "monitoring where included in the service plan. Client acknowledges that no system is completely "
            "secure and agrees to follow recommended security practices.",
        ),
        (
            "Backups",
            "Provider will perform scheduled backups as outlined in the selected plan. While Provider takes "
            "reasonable precautions, Client is encouraged to maintain independent backups of critical content "
            "and data.",
        ),
        (
            "Support",
            "Technical support is provided via email and phone during standard business hours. Response times "
            "may vary based on issue severity and current workload. Emergency support outside standard hours "
            "may incur additional fees if agreed upon in advance.",
        ),
        (
            "Client Responsibilities",
            "Client agrees to provide timely access, content, approvals, and accurate account information. "
            "Client is responsible for the accuracy of website content, compliance with applicable laws, "
            "and payment of all fees according to this Agreement.",
        ),
    ]

    for title, body in terms:
        c.setFillColor(BLUE)
        c.setFont("Helvetica-Bold", 7.8)
        c.drawString(MARGIN, y, title)
        y = draw_wrapped(c, MARGIN + 8, y - 10, CONTENT_W - 8, body, size=7, leading=9) - 4

    y = draw_section_header(c, y - 2, "5. Payment Terms")
    payment_items = [
        "Monthly service fees are billed in advance on the billing cycle selected in Section 2.",
        "Payment is due upon receipt of invoice. Late payments may incur a late fee of 1.5% per month on outstanding balances.",
        "Provider may suspend services for accounts more than 15 days past due after written notice to Client.",
        "Fees paid are non-refundable except where required by law or expressly agreed in writing.",
    ]
    y = draw_bullet_block(c, MARGIN, y - 8, CONTENT_W, payment_items) - 2

    y = draw_section_header(c, y, "6. Termination")
    term_text = (
        "Either party may terminate this Agreement with thirty (30) days written notice. Client remains "
        "responsible for all fees incurred through the effective termination date. Upon termination, "
        "Provider will cooperate in a reasonable transition of hosting access and Client data, subject "
        "to outstanding account balances being paid in full."
    )
    y = draw_wrapped(c, MARGIN, y - 8, CONTENT_W, term_text, size=7, leading=9) - 4

    y = draw_section_header(c, y, "7. General Provisions")
    general_text = (
        "This Agreement constitutes the entire agreement between the parties regarding the subject matter "
        "hereof and supersedes all prior discussions or agreements. Any amendments must be in writing and "
        "signed by both parties. This Agreement shall be governed by the laws of the State of Florida."
    )
    y = draw_wrapped(c, MARGIN, y - 8, CONTENT_W, general_text, size=7, leading=9) - 8

    sig_w = (CONTENT_W - 20) / 2
    sig_left = MARGIN
    sig_right = MARGIN + sig_w + 20

    for sx, title, prefix in [
        (sig_left, "CLIENT", "client"),
        (sig_right, f"{PROVIDER_NAME.upper()} (PROVIDER)", "provider"),
    ]:
        c.setFillColor(ORANGE)
        c.rect(sx, y - 16, sig_w, 16, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(sx + sig_w / 2, y - 12, title)

        fy = y - 30
        for field_suffix, label in [
            ("signature", "Signature:"),
            ("signer_name", "Name:"),
            ("signer_title", "Title:"),
            ("sign_date", "Date:"),
        ]:
            fname = f"{prefix}_{field_suffix}"
            draw_label(c, sx, fy, label)
            draw_field_bg(c, sx, fy - 16, sig_w)
            add_text_field(form, fname, sx + 1, fy - 15, sig_w - 2)
            if field_suffix == "signature":
                c.setFillColor(ORANGE)
                c.setFont("Helvetica-Oblique", 6.5)
                c.drawRightString(sx + sig_w - 4, fy - 11, "Sign Here \u2190")
            fy -= 28

    draw_footer(c)
    c.showPage()


def main():
    if not LOGO_PATH.is_file():
        raise FileNotFoundError(f"Logo not found: {LOGO_PATH}")

    c = canvas.Canvas(str(OUTPUT_PATH), pagesize=letter)
    c.setTitle("Website Hosting & Maintenance Agreement")
    c.setAuthor(PROVIDER_NAME)
    form = c.acroForm

    page1(c, form)
    page2(c, form)

    c.save()
    print(f"Created: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
