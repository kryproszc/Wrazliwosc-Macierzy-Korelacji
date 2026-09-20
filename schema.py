ove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item package-lock.json -Force -ErrorAction SilentlyContinue
Instalacja z obejściem peer-resolvera
npm install --legacy-peer-deps --no-audit --no-fund
Potem
npm run build
npm run start
