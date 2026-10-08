#!/bin/bash
# watchr auf dem Mac starten: Doppelklick (beim ersten Mal ggf. Rechtsklick > Öffnen)
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und danach erneut starten."
  open https://nodejs.org; read -r; exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Deine Node.js-Version ist $(node -v). watchr braucht 22.13 oder neuer."
  echo "Bitte die aktuelle LTS-Version von https://nodejs.org installieren und danach erneut starten."
  open https://nodejs.org; read -r; exit 1
fi
if [ ! -f .env ]; then
  sed "s/WATCHER_TOKEN=bitte-aendern/WATCHER_TOKEN=watchr-$RANDOM$RANDOM$RANDOM/" .env.example > .env
  echo "Einstellungen in .env angelegt."
fi
[ -d node_modules ] || { echo "Installiere watchr, das dauert beim ersten Mal 1-2 Minuten ..."; npm install || { read -r; exit 1; }; }
echo "watchr startet. Die Website öffnet sich gleich unter http://localhost:3000"
(sleep 6; open http://localhost:3000) &
npm start
