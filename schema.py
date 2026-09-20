Zrób teraz tylko to, bez zmiany kodu:

Ustaw nowy cache npm:
npm config set cache D:\npm-cache-temp --global

Usuń stare moduły:
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue

Instalacja z nowym cache:
npm ci --cache D:\npm-cache-temp --no-audit --no-fund

Potem:
npm run build
npm run start

Jeśli krok 3 dalej padnie, wtedy:

npx -y npm@10.8.2 ci --cache D:\npm-cache-temp --no-audit --no-fund
jeśli nadal błąd, przeinstaluj Node.js LTS 20.x na serwerze i powtórz kroki.
