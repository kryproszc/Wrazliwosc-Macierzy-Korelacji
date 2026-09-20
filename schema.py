Ustaw cache na istniejący katalog, np. na C:
New-Item -ItemType Directory -Force -Path C:\npm-cache-temp
npm config set cache C:\npm-cache-temp --global
Wyczyść stan instalacji:
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item package-lock.json -Force -ErrorAction SilentlyContinue
npm cache clean --force
Zainstaluj ponownie:
npm install --cache C:\npm-cache-temp --no-audit --no-fund
Potem uruchom:
npm run build
npm run start
Jeśli dalej padnie:

Sprawdź połączenie z rejestrem:
npm ping
Usuń ewentualne stare proxy:
npm config delete proxy
npm config delete https-proxy
Powtórz npm install z cache na C:.
