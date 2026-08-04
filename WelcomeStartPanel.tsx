cd C:\Users\TWOJ_UZYTKOWNIK\Desktop\Test_OWU

Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue

$env:HTTP_PROXY="http://PROXY:PORT"
$env:HTTPS_PROXY="http://PROXY:PORT"

py -3.11 -m venv .venv

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip setuptools wheel

python -m pip install docling

python -c "import docling; print('Docling działa')"

docling-tools models download

python .\scripts\parser.py
