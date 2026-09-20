Wejdź do katalogu aplikacji.
Usuń stare zależności:
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
Wyczyść cache npm:
npm cache clean --force
Upewnij się, że masz stabilną wersję npm:
npm -v
Jeśli trzeba:
npm install -g npm@10.8.2
Zainstaluj zależności:
npm install --no-audit --no-fund
Uruchom jak wcześniej:
npm run build
npm run start
