from pypdf import PdfReader, PdfWriter

input_pdf = "palgrave.gpp.2510116.pdf"
output_pdf = "palgrave.gpp.2510116_z_haslem.pdf"
password = "MojeHaslo123"

reader = PdfReader(input_pdf)
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

writer.encrypt(password)

with open(output_pdf, "wb") as f:
    writer.write(f)

print("Gotowe - PDF został zabezpieczony hasłem.")
