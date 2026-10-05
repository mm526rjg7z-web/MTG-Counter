# MTG Lebenspunkte-Zähler

Lebenspunkte-Zähler für Magic: The Gathering mit Schwerpunkt **Commander (EDH)**, gebaut als Progressive Web App.
Gedacht für Smartphones im Hochformat, die flach auf dem Tisch liegen und von mehreren Leuten gleichzeitig bedient werden.
Bedienbarkeit geht vor Funktionsumfang.

- Reines HTML, CSS und JavaScript (ES Modules). Kein Framework, kein Build-Schritt, keine externen Abhängigkeiten, keine CDNs, keine Webfonts.
- Läuft nach dem ersten Laden **komplett offline**. Der Spielstand bleibt nur auf dem Gerät.
- Oberfläche auf Deutsch, Code und Kommentare auf Englisch.

## Funktionen

**Spielerzahl und Layout**
- Start-Bildschirm mit Spielerzahl 2 bis 6 und Startleben 20, 30, 40 (Standard) oder frei wählbar (1 bis 999), mit Vorschau der Anordnung.
- 2 Spieler: oben/unten. 3 Spieler: zwei oben, einer unten (breites Feld). 4 Spieler: 2×2. 5 Spieler: 2×3 mit breitem Feld unten. 6 Spieler: 2×3.
- Jedes Feld ist zur nächstgelegenen Tischkante gedreht: obere Reihe 180°, untere Reihe 0°, bei drei Reihen die mittleren Felder links 90° und rechts 270°.
- Pro Spieler eine eigene kräftige Farbe (Text mindestens 4,5:1 Kontrast), Name per Tipp auf den Namen änderbar, Farbauswahl dazu (Farben bleiben eindeutig, bei Doppelwahl tauschen die Spieler).

**Lebenspunkte**
- Große Zahl in der Mitte. Linke Feldhälfte = minus, rechte Hälfte = plus, mit sichtbarem −/+-Symbol.
- Tippen = 1 Punkt. Gedrückt halten wiederholt, nach einer Sekunde in 5er-Schritten. Zusätzlich Buttons für −5 und +5.
- Kleine Anzeige mit der Summe der letzten Sekunden (z. B. „−7“). Sie verschwindet nach einer kurzen Pause und wird als **ein** Eintrag in die Historie übernommen.
- Leben darf negativ werden. Bei 0 oder weniger ist das Feld als „ausgeschieden“ markiert (abgedunkelt, Totenkopf), bleibt aber bedienbar, damit sich Fehler korrigieren lassen.

**Zähler** (pro Spieler im ausklappbaren Bereich; geschlossen werden nur Werte größer als 0 angezeigt)
- Commander-Schaden getrennt je gegnerischem Spieler. 21 von einem einzelnen Gegner = ausgeschieden.
- Gift (10 = ausgeschieden), Energie, Erfahrung.
- Monarch und Initiative: immer nur bei einem Spieler aktiv.

**Würfel, Münze, Startspieler** (Menü in der Bildschirmmitte)
- d4, d6, d8, d10, d12, d20, beliebig viele gleichzeitig, mit Summe. Münzwurf. Zufälliger Startspieler.
- Ergebnis groß im Overlay mit kurzer Animation, Tippen schließt. „Nochmal“ wiederholt den Wurf.
- Zufall ausschließlich über `crypto.getRandomValues` (mit Rejection Sampling, also ohne Modulo-Verzerrung).

**Historie und Rückgängig**
- Log aller Änderungen mit Spieler, Art, alt → neu und Uhrzeit.
- „Rückgängig“ (Dock, Menü, Historie) macht die jeweils letzte Aktion rückgängig, beliebig oft.

**Spielverwaltung**
- Menü: Neues Spiel (mit Bestätigung, behält Spielerzahl, Startleben, Namen, Farben), Einstellungen, Historie, Hilfe/Über.
- Der Spielstand wird laufend im `localStorage` gespeichert und beim Öffnen wiederhergestellt.
- Bildschirm bleibt während des Spiels an (Screen Wake Lock API, abschaltbar, mit Hinweis statt Fehler, wenn nicht unterstützt).
- Kurzes haptisches Feedback (`navigator.vibrate`), abschaltbar.

**Bedienung ohne Fehlgriffe**
- Kein Zoomen, Scrollen, Textauswählen oder Kontextmenü auf dem Spielfeld, kein Pull-to-Refresh. Mehrere Finger gleichzeitig auf verschiedenen Feldern funktionieren unabhängig.
- Safe-Area-Insets (Notch, Gestenleiste) werden berücksichtigt. Zahlen sind tabellarisch gesetzt, nichts springt. `prefers-reduced-motion` wird beachtet. Tastatur und Screenreader: `aria-label`s und sichtbare Fokus-Rahmen.

## Lokal starten

Die App braucht einen Webserver, `file://` funktioniert nicht (ES Modules, Service Worker). Auf `http://localhost` funktionieren auch Service Worker und Offline-Modus.

```bash
cd mtg-counter
node scripts/serve.mjs          # http://localhost:8080  (anderer Port: node scripts/serve.mjs 3000)
# oder: python3 -m http.server 8080
# oder: npx serve
```

Auf dem Handy testen: Mit USB-Debugging in Chrome unter `chrome://inspect/#devices` den Port weiterleiten und `http://localhost:8080` am Handy öffnen. Das zählt als sicherer Kontext. Über die WLAN-Adresse des Rechners (`http://192.168.…`) laden zwar die Seite, aber kein Service Worker, keine Installation und kein Wake Lock, weil dafür HTTPS nötig ist.

## Veröffentlichen (HTTPS)

Alle Pfade in der App sind relativ. Sie läuft deshalb unter jeder Adresse und in jedem Unterordner. Voraussetzung ist **HTTPS** (für Service Worker, Installation und Wake Lock).

### GitHub Pages

Variante A, ohne Workflow: Repository-Einstellungen → *Pages* → *Build and deployment* → *Deploy from a branch* → Branch (z. B. `main`) und Ordner `/ (root)`. Die App ist dann unter `https://<konto>.github.io/<repository>/mtg-counter/` erreichbar. Zur Auswahl stehen bei dieser Variante nur `/` (root) und `/docs`. Wer die App direkt unter `https://<konto>.github.io/<repository>/` haben will, benennt den Ordner um (`git mv mtg-counter docs`) und wählt `/docs`.
([Dokumentation: Veröffentlichungsquelle konfigurieren](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site))

Variante B, mit GitHub Actions (veröffentlicht nur den Ordner `mtg-counter`, ohne Tests und Skripte): Unter *Pages* als Quelle *GitHub Actions* wählen und diese Datei als `.github/workflows/pages.yml` ablegen:

```yaml
name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: mtg-counter
      - id: deployment
        uses: actions/deploy-pages@v4
```

Die Versionen der Actions bei Bedarf auf die jeweils aktuelle Hauptversion anheben ([Dokumentation: eigene Workflows für Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)). Der Workflow läuft bei jedem Push auf `main` (Branch-Namen bei Bedarf anpassen), die App muss dort also zuerst per Merge ankommen. Bei Variante A kann dagegen jeder Branch ausgewählt werden.

### Anderer HTTPS-Hoster (Netlify, Cloudflare Pages, Vercel, eigener Server …)

Den Inhalt von `mtg-counter/` als statische Seite ausliefern: kein Build-Befehl, Auslieferungsordner `mtg-counter`. Es sind keine Umleitungen oder Rewrites nötig. Auf korrekte Content-Types achten (`.js` als `text/javascript`, `.webmanifest` als `application/manifest+json`), das ist bei den genannten Hostern Standard.

### Updates ausliefern

Der Service Worker liefert Dateien aus dem Cache. Damit ein Update ankommt, muss sich der Cache-Name ändern. Das erledigt ein Skript, das die Dateiliste und eine Prüfsumme der Inhalte in `sw.js` einträgt:

```bash
node scripts/update-cache-version.mjs     # nach jeder Änderung an einer App-Datei, dann committen und veröffentlichen
```

Vergisst man das, schlägt `npm test` fehl. Beim nächsten Start installiert der Browser den neuen Service Worker im Hintergrund, löscht die alten Caches und liefert danach die neue Version aus. Eine geöffnete App läuft bis zum Neustart mit dem alten Stand, also einmal komplett schließen und neu öffnen.

## Auf dem Handy installieren

**Android (Chrome)**: Seite öffnen, Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen* → bestätigen. Die App startet dann im Vollbild und im Hochformat.

**iPhone/iPad (Safari)**: Seite öffnen, Teilen-Symbol → *Zum Home-Bildschirm* → *Hinzufügen*. Ab iOS 16.4 geht das auch in anderen Browsern (Chrome, Edge, Firefox) über deren Teilen-Menü.

Hinweise zu iOS: `navigator.vibrate` wird von iOS nicht unterstützt (die App erklärt das in den Einstellungen). Der Screen Wake Lock funktionierte in Home-Bildschirm-Apps wegen eines WebKit-Fehlers erst ab **iOS 18.4** ([WebKit-Bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)). Auf älteren Versionen die automatische Sperre in den iOS-Einstellungen auf „Nie“ stellen.

Browser-Voraussetzungen: Container Queries, `color-mix()` und das `<dialog>`-Element, also etwa Chrome/Edge 111, Safari/iOS 16.2, Firefox 113 oder neuer. In älteren Browsern zeigt die App einen Hinweis statt eines kaputten Layouts.

## Tests

```bash
cd mtg-counter
npm test                    # Unit-Tests (Node ≥ 22, keine Abhängigkeiten): Logik, Layouts, Zufall, Speicher, Service Worker, Manifest

npm install                 # nur für die E2E-Tests: installiert Playwright
npx playwright install chromium
npm run test:e2e            # echter Browser, Mobil-Viewport, Touch-Eingabe
# mit global installiertem Playwright:  NODE_PATH=$(npm root -g) node tests/e2e.mjs
# Screenshots speichern:                 SHOTS_DIR=/pfad/zum/ordner npm run test:e2e
# einzelne Gruppen:                      ONLY="Layout" npm run test:e2e
```

Die Unit-Tests führen auch den Service Worker in einer Sandbox mit simuliertem Cache aus (Installieren, Aufräumen alter Caches, Cache-First, Offline-Fallback).
Die E2E-Tests prüfen unter anderem: alle Layouts für 2 bis 6 Spieler auf vier Handy-Größen (Drehung, lückenloses Raster, Dock verdeckt nichts, Tippziele ≥ 48 px, Panel ohne Überlappung), Tippen, Halten (Einzel- und 5er-Schritte), Mehrfinger-Bedienung, Commander-Schaden 21, Gift, Marker, Rückgängig, Neuladen, Offline-Start, Service-Worker-Update samt Aufräumen, Vibration und Wake Lock (per Mock), reduzierte Bewegung, sowie in jeder Gruppe, dass die Konsole leer bleibt.

## Aufbau

```
mtg-counter/
├── index.html            Seitengerüst, Icon-Sprite, alle Dialoge
├── styles.css            Design, Layout (Container Queries), Dialoge
├── app.js                Einstieg: verbindet Zustand, Oberfläche und Geräte-APIs
├── manifest.webmanifest  Web App Manifest
├── sw.js                 Service Worker (Cache-First, versioniert; Dateiliste wird generiert)
├── icons/                App-Icons (aus icon.svg erzeugt, inkl. maskable und apple-touch-icon)
├── js/
│   ├── game.js           Spielzustand, Aktionen, Undo, Ausscheiden (rein, ohne DOM)
│   ├── layout.js         Raster und Drehung je Spielerzahl (rein)
│   ├── palette.js        Spielerfarben samt Kontrastberechnung
│   ├── random.js         Würfel, Münze, Startspieler über crypto.getRandomValues
│   ├── format.js         Zahlen, Zeiten, Texte der Historie
│   ├── storage.js        localStorage mit Prüfung und Rückfall auf den Arbeitsspeicher
│   ├── field.js          ein Spielerfeld inklusive Zähler-Panel
│   ├── board.js          alle Felder auf dem Raster
│   ├── hold.js           Tippen und Halten mit Wiederholung
│   ├── dialogs.js        Menü, Historie, Spielereditor, Bestätigung, Hilfe
│   ├── tools.js          Würfel, Münze, Startspieler
│   ├── setup.js          Start-Bildschirm und Einstellungen
│   ├── haptics.js, wakelock.js, dom.js, version.js
├── scripts/              serve.mjs (Server), make-icons.mjs, update-cache-version.mjs
└── tests/                *.test.mjs (Unit), e2e.mjs (Playwright)
```

**Datenmodell.** Ein Spiel besteht aus `players[]` (`id`, `name`, `color`, `life`, `poison`, `energy`, `experience`, `cmd[quelle]` = Commander-Schaden von jedem Gegner), `monarch` und `initiative` (je eine Spieler-ID oder `null`) und `history[]`. Ein Eintrag der Historie hat die Form `{ id, t, kind, pid, src, from, to }` und ist zugleich der Rückgängig-Stapel: Rückgängig setzt den Wert auf `from` zurück. Änderungen am selben Wert innerhalb von 1,5 Sekunden werden zu einem Eintrag zusammengefasst (daraus entsteht auch die „−7“-Anzeige), eine Gesamtänderung von 0 hinterlässt keinen Eintrag. „Ausgeschieden“ wird nicht gespeichert, sondern aus den Werten abgeleitet. Alle Funktionen in `game.js` geben einen neuen Zustand zurück und sind ohne Browser testbar.

**Layout und Drehung.** `layout.js` beschreibt je Spielerzahl ein Raster aus Zellen mit Drehwinkel. Jede Zelle enthält einen Rahmen, der um diesen Winkel gedreht wird. Der Rahmen ist ein eigener Container (Container Queries), alle Größen darin (Lebenszahl, Buttons, Panel) leiten sich von seiner tatsächlichen Breite und Höhe ab, egal wie er gedreht ist. Die oberen 30 px jedes Rahmens bleiben frei von Bedienelementen, weil das Dock in der Bildschirmmitte in die Felder hineinragt. Bei drei Reihen liegt die Mitte in den seitlich gedrehten Feldern, dort ist das Dock senkrecht. Für Rahmen unter 190 px Höhe (Seitenfelder bei 5 bis 6 Spielern auf schmalen Handys) und für schmale, niedrige Rahmen gibt es verdichtete Stufen.

## Bekannte Grenzen

- **Echtes Gerät nicht getestet.** Alle Tests liefen in Chromium (Playwright, Touch- und Mobil-Emulation). Vibration und Wake Lock sind nur per Mock geprüft, iOS Safari und der Home-Bildschirm-Modus gar nicht. Die Safe-Area-Insets (Notch, Gestenleiste) sind per CSS-Variablen simuliert.
- Commander-Schaden wird **je gegnerischem Spieler** gezählt, nicht je Commander. Bei Partner-Commandern zählt der Schaden beider Commander desselben Gegners zusammen.
- 5 und 6 Spieler brauchen Platz: Bei Handys unter etwa 390 px Breite sind Tippflächen im Zähler-Panel teils nur 38 px statt 48 px groß, weil die Felder dann nur noch rund 180 px hoch sind. Bei 2 bis 4 Spielern gibt es das Problem nicht.
- Das Zähler-Panel ersetzt beim Öffnen die Lebenszahl des Feldes. Zum Ändern des Lebens zuerst schließen.
