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
- Commander-Schaden wird **je Commander** gezählt und heißt „Schaden vom Commander von <Name>“. Der Zähler hängt am Besitzer des Commanders, nicht an dem, der ihn gerade steuert: Übernimmt Spieler A per Kontrollwechsel den Commander von Spieler B und trifft damit Spieler C, bekommt C Schaden vom „Commander von B“. Jeder Empfänger hat eine Kachel je Gegner (Farbe und Wert) und darunter −/+: Tippen = 1, Halten wiederholt und zählt nach einer Sekunde in 5er-Schritten, auf Feldern ab 320 px Höhe (bei 2 bis 4 Spielern auf allen getesteten Handygrößen) zusätzlich −5/+5. Die Beschriftung zeigt den aktuellen Namen und folgt einer Umbenennung.
- Auch der **eigene Commander** ist eine Quelle: Steuert ein Gegner ihn per Kontrollwechsel und trifft damit den Besitzer, zählt das die letzte Kachel der Reihe (gestrichelt, in der Farbe des eigenen Feldes), beschriftet „Schaden vom eigenen Commander“. Sie zählt getrennt von allen anderen, wird ab 21 ebenfalls rot und hängt an Lebenskopplung, Rückgängig und Speichern wie die übrigen.
- Ab 21 von einem einzelnen Commander ist der Wert rot (Hinweis „tödlich“), das Feld wird wie bei 0 Leben oder 10 Gift als „ausgeschieden“ markiert. Nichts wird gesperrt oder entfernt, es lässt sich weiterzählen und zurücknehmen.
- Menü-Option **„Commander-Schaden zieht auch Lebenspunkte ab“** (Standard aus, wird mit den Einstellungen gespeichert): Ändert sich der Commander-Schaden um n, ändert sich das Leben des Empfängers um −n, auch beim Zurücknehmen. Gerechnet wird mit der Änderung, die wirklich stattfand (bei 0 Schaden kostet ein weiteres „−“ nichts). Beides steht in **einem** Historien-Eintrag, ein Rückgängig nimmt beides zurück.
- Gift (10 = ausgeschieden), Energie, Erfahrung.
- Monarch und Initiative: immer nur bei einem Spieler aktiv.

**Würfel, Münze, Startspieler** (Menü in der Bildschirmmitte)
- d4, d6, d8, d10, d12, d20, beliebig viele gleichzeitig, mit Summe. Münzwurf. Zufälliger Startspieler.
- Ergebnis groß im Overlay mit kurzer Animation, Tippen schließt. „Nochmal“ wiederholt den Wurf.
- Zufall ausschließlich über `crypto.getRandomValues` (mit Rejection Sampling, also ohne Modulo-Verzerrung).

**Historie und Rückgängig**
- Log aller Änderungen mit Spieler, Art, alt → neu und Uhrzeit.
- „Rückgängig“ (Dock, Menü, Historie) macht die jeweils letzte Aktion rückgängig, beliebig oft. Commander-Schaden, der auch Leben abzieht, steht als ein Eintrag („Schaden vom Commander von Ben: 0 → 3 (+3) · Leben 40 → 37 (−3)“) und wird mit einem Rückgängig ganz zurückgenommen.

**Spielverwaltung**
- Menü: Neues Spiel (mit Bestätigung, behält Spielerzahl, Startleben, Namen, Farben und Optionen, setzt Leben, Zähler, Commander-Schaden und Historie zurück), Einstellungen, Historie, Hilfe/Über und der Schalter für Commander-Schaden und Leben.
- Der Spielstand wird laufend im `localStorage` gespeichert und beim Öffnen wiederhergestellt.
- Bildschirm bleibt während des Spiels an (Screen Wake Lock API, abschaltbar, mit Hinweis statt Fehler, wenn nicht unterstützt).
- Kurzes haptisches Feedback (`navigator.vibrate`), abschaltbar.
- Anzeige-Diagnose (Startbildschirm unten, Hilfe): Tipp-Test und gemessene Bildschirmwerte, falls auf einem Gerät Tippflächen neben den Buttons sitzen.

**Bedienung ohne Fehlgriffe**
- Kein Zoomen, Scrollen, Textauswählen oder Kontextmenü auf dem Spielfeld, kein Pull-to-Refresh. Mehrere Finger gleichzeitig auf verschiedenen Feldern funktionieren unabhängig.
- Notch, Gestenleiste und abgerundete Ecken: Auf dem iPhone beginnt die Seite unter der Statusleiste. Die Felder halten Abstand zu den Safe-Area-Insets, die untere Buttonreihe zusätzlich zu den Displayecken (siehe unten). Zahlen sind tabellarisch gesetzt, nichts springt. `prefers-reduced-motion` wird beachtet. Tastatur und Screenreader: `aria-label`s und sichtbare Fokus-Rahmen.

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

Vergisst man das, schlägt `npm test` fehl. Beim nächsten Start installiert der Browser den neuen Service Worker im Hintergrund und löscht die alten Caches. Ab Version 1.0.1 lädt sich die laufende App danach **einmal selbst neu** (der Spielstand wird vorher gespeichert). Beim Zurückkehren in die App wird höchstens alle 5 Minuten nach einer neuen Version gesucht, damit auch eine tagelang offene Home-Bildschirm-App aktuell wird. Eine App mit einer älteren Version hat diese Automatik noch nicht: einmal komplett schließen (im App-Wechsler nach oben wischen) und neu öffnen. Die Version steht im Startbildschirm unten und unter *Hilfe / Über*.

## Auf dem Handy installieren

**Android (Chrome)**: Seite öffnen, Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen* → bestätigen. Die App startet dann im Vollbild und im Hochformat.

**iPhone/iPad (Safari)**: Seite öffnen, Teilen-Symbol → *Zum Home-Bildschirm* → *Hinzufügen*. Ab iOS 16.4 geht das auch in anderen Browsern (Chrome, Edge, Firefox) über deren Teilen-Menü.

Hinweise zu iOS: Die Statusleiste ist deckend (`black`), die Seite beginnt darunter. `navigator.vibrate` wird von iOS nicht unterstützt (die App erklärt das in den Einstellungen). Der Screen Wake Lock funktionierte in Home-Bildschirm-Apps wegen eines WebKit-Fehlers erst ab **iOS 18.4** ([WebKit-Bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)). Auf älteren Versionen die automatische Sperre in den iOS-Einstellungen auf „Nie“ stellen.

Browser-Voraussetzungen: Container Queries, `color-mix()` und das `<dialog>`-Element, also etwa Chrome/Edge 111, Safari/iOS 16.2, Firefox 113 oder neuer. In älteren Browsern zeigt die App einen Hinweis statt eines kaputten Layouts.

### iPhone: Tippflächen, Statusleiste, Ränder und Ecken

**Konfiguration.** `index.html` setzt `viewport-fit=cover` und die deckende Statusleiste (`apple-mobile-web-app-status-bar-style: black`), das Manifest `display: standalone`. `viewport-fit=cover` ist nötig, damit `env(safe-area-inset-*)` die echten Werte liefert (ohne die Angabe sind sie immer 0 und die Seite läuft unter der Gestenleiste bis an den unteren Rand). Die deckende Statusleiste ist dafür die Voraussetzung: Die Seite beginnt unter ihr und braucht oben keinen Abstand. **Keine der beiden Angaben ohne die andere ändern**, ein Test (`tests/pwa.test.mjs`) hält das fest.

**Abstände (`styles.css`).** Alle Werte stehen zentral in `:root`: `--safe-top/right/bottom/left` sind `env(safe-area-inset-*)`. Felder, die einen Bildschirmrand berühren, bekommen diesen Abstand als Innenabstand. Dazu kommt `--corner = 0,6 × --safe-bottom`: Jedes iPhone mit Home-Indikator hat auch abgerundete Ecken (Radius etwa 40 bis 55 px), der untere Inset dient als Hinweis darauf. Die untere Buttonreihe (−5, Name, Zähler, +5) und die Tab-Leiste des Zähler-Panels halten damit unten und an den äußeren Seiten rund 20 px Zusatzabstand zur Gestenleiste und zur Ecke (bei 34 px Inset: 34 + 20 px unten, 20 px seitlich). Bei 5 bis 6 Spielern (drei Reihen, nur etwa 260 px hoch) ist der Zusatz unten kleiner (6 px), sonst werden Zahlen und Panels der unteren Reihe zu klein. Wo `env()` 0 liefert (Android, Desktop, iPhones ohne Home-Indikator), sind alle Zusätze 0 und nichts verschiebt sich. Ein fester Zusatz statt des Faktors würde auch Android verschieben. Die obere Reihe bleibt unverändert, die deckende Statusleiste deckt die oberen Ecken ab. Im Querformat gelten die seitlichen Insets (Notch) für die Felder am linken und rechten Rand.

**Altes Symbol.** Die Angabe zur Statusleiste liest iOS nur beim Hinzufügen zum Home-Bildschirm. Ein Symbol, das vor Version 1.0.1 angelegt wurde, hat noch die transparente Leiste, und zusammen mit `viewport-fit=cover` zeichnet iOS 26 die Seite dann ab dem oberen Bildschirmrand, bemisst das Fenster aber um die Höhe der Statusleiste zu kurz ([WebKit-Bug 301108](https://bugs.webkit.org/show_bug.cgi?id=301108)). Die Tippflächen liegen dann etwa um diese Höhe (47 bis 59 px) unter den gezeichneten Buttons. Sichtbar ist das an einem schwarzen Streifen unten, so hoch wie die Statusleiste (etwa 59 px), weil das Fenster zu kurz ist. Dazu kommt bei iOS 26.1 und neuer ein **dunkler, unscharfer Verlauf über den oberen Feldern**: Den zeichnet iOS selbst über jede Seite, die unter einer transparenten Statusleiste (`black-translucent`) liegt, er kommt nicht aus der App (im Code gibt es keinen Verlauf, Blur oder Filter an dieser Stelle) und lässt sich weder per CSS noch per JavaScript abschalten. Berichte aus anderen Projekten ([autobrr/qui#2520](https://github.com/autobrr/qui/issues/2520), [Suwayomi-WebUI#1173](https://github.com/Suwayomi/Suwayomi-WebUI/issues/1173), [cairn-web#72](https://github.com/JoanRoucoux/cairn-web/pull/72)) lösen das, indem das Symbol ohne `black-translucent` neu angelegt wird: Dann ist die Leiste deckend, ohne Verlauf, und die Seite beginnt darunter. Bis zum Löschen und Neuanlegen ändert nichts an der Seite etwas daran, denn iOS merkt sich die Angabe pro Symbol. Die App erkennt das (iOS-Home-Bildschirm-App mit Inset oben, `statusBarOverlapsPage` in `js/viewport.js`) und zeigt 20 Sekunden lang einen Hinweis. **Abhilfe: Symbol vom Home-Bildschirm löschen, die Seite in Safari neu laden und über Teilen → *Zum Home-Bildschirm* neu hinzufügen.** Der Spielstand liegt im Speicher der App und geht dabei verloren. Viele Projekte haben das Problem so gelöst, die deckende Statusleiste zu wählen (Beispiele: [band-app/band#681](https://github.com/band-app/band/pull/681), [coder/xum#5656](https://github.com/coder/xum/pull/5656)). Laut [Apples Meta-Tag-Dokumentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html) beginnt der Inhalt bei `default` und `black` unter der Statusleiste, bei `black-translucent` füllt er den ganzen Bildschirm.

**Spielerfarben bis zur Oberkante geht auf iOS 26.1 und neuer nicht sauber.** Mit transparenter Leiste liegt der Systemverlauf über den Farben, mit deckender Leiste ist der Bereich der Statusleiste schwarz und die Farben beginnen darunter. Die Lesbarkeit von Uhrzeit und Akku ist in beiden Fällen gesichert: Der Verlauf von iOS ist genau dafür da, und die deckende Leiste ist schwarz mit weißer Schrift. Dass eine neu angelegte Version mit `black` auf iOS 26.1 und neuer ohne Verlauf bleibt, ist aus Berichten abgeleitet (Suwayomi-WebUI#1173 beobachtet das mit `black`, die Seite ist dort 793 statt 852 px hoch), nicht auf einem Gerät geprüft.

**Weitere Hilfen.**
- Bleibt der sichtbare Bereich nach dem Schließen der Tastatur oder nach einer Drehung gegen die Seite verschoben (`visualViewport.offsetTop` ungleich 0, in iOS 26.0 gemeldet: [Apple Developer Forums](https://developer.apple.com/forums/thread/800154)), scrollt die App die Seite zurück zum Ursprung. Solange ein Textfeld Fokus hat oder gezoomt ist, greift sie nicht ein.
- Die **Anzeige-Diagnose** (Startbildschirm unten, oder *Hilfe / Über*) enthält einen **Tipp-Test** (auf die Mitte eines Kreuzes tippen: die App meldet, wie weit daneben sie den Tipp erkennt), zeigt gemessene Werte (Fenster, sichtbarer Bereich, Versatz, Safe Area, Statusleiste, Version, Cache) und hat die Schaltfläche *Neu ausrichten*.
- Updates kommen selbst an (siehe oben). Nach einem Update: App komplett schließen (im App-Wechsler nach oben wischen) und neu öffnen, bei Bedarf ein zweites Mal. Die Version steht unten im Startbildschirm.

**Was sich ohne iPhone nicht prüfen lässt.** Die Tests laufen in Chromium, das keine Safe-Area-Insets meldet: Sie werden über die CSS-Variablen simuliert. Dass die Abstände auf einem echten iPhone so aussehen, wie sie gemessen werden, und dass `env(safe-area-inset-bottom)` dort wirklich 34 px liefert, ist aus Dokumentation und Berichten abgeleitet, nicht gemessen. Die Anzeige-Diagnose zeigt die echten Werte (`Safe Area o / r / u / l`).

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
Die E2E-Tests prüfen unter anderem: alle Layouts für 2 bis 6 Spieler auf vier Handy-Größen (Drehung, lückenloses Raster, Dock verdeckt nichts, Tippziele ≥ 48 px, Panel ohne Überlappung), Tippen, Halten (Einzel- und 5er-Schritte), Mehrfinger-Bedienung, Commander-Schaden (je Commander, Umbenennung, ±1 und ±5, rot ab 21, mit und ohne Lebenskopplung, ein Rückgängig für beides, Neuladen, Neues Spiel, der eigene Commander bei 2, 4 und 6 Spielern), Gift, Marker, Rückgängig, Neuladen, Offline-Start, Service-Worker-Update samt Aufräumen und genau einem Neuladen mit erhaltenem Spielstand, Ausrichtung des sichtbaren Bereichs (Versatz, Tastatur, Zoom) und Anzeige-Diagnose, Vibration und Wake Lock (per Mock), reduzierte Bewegung, sowie in jeder Gruppe, dass die Konsole leer bleibt.

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
│   ├── viewport.js       hält den sichtbaren Bereich ausgerichtet (iOS), misst Fenster und Safe Area
│   ├── diagnostics.js    Dialog „Anzeige-Diagnose“
│   ├── haptics.js, wakelock.js, dom.js, version.js
├── scripts/              serve.mjs (Server), make-icons.mjs, update-cache-version.mjs
└── tests/                *.test.mjs (Unit), e2e.mjs (Playwright)
```

**Datenmodell.** Ein Spiel besteht aus `players[]` (`id`, `name`, `color`, `life`, `poison`, `energy`, `experience`, `cmd[quelle]` = Commander-Schaden von jedem Gegner), `monarch` und `initiative` (je eine Spieler-ID oder `null`) und `history[]`. Ein Eintrag der Historie hat die Form `{ id, t, kind, pid, src, from, to, life? }` und ist zugleich der Rückgängig-Stapel: Rückgängig setzt den Wert auf `from` zurück. `cmd[quelle]` ist der Commander-Schaden, den der Spieler vom Commander des Besitzers `quelle` erhalten hat (`damage[Empfänger][Quelle-Commander]`, ganzzahlig, mindestens 0). Der eigene Platz (`cmd[i][i]`) zählt den Schaden von seinem eigenen Commander, den ein Gegner gesteuert hat. Commander-Einträge, die auch das Leben geändert haben (Option „zieht auch Lebenspunkte ab“), tragen zusätzlich `life: { from, to }` mit dem Leben vor und nach derselben Änderung, sodass ein Rückgängig beides setzt. Änderungen am selben Wert innerhalb von 1,5 Sekunden werden zu einem Eintrag zusammengefasst (daraus entsteht auch die „−7“-Anzeige), eine Gesamtänderung von 0 hinterlässt keinen Eintrag. Ein Eintrag wandert dabei ans Ende der Historie; das ist nur erlaubt, wenn kein späterer Eintrag denselben Wert angefasst hat (sonst stimmten `from` und `to` nicht mehr), und gekoppelte und ungekoppelte Änderungen werden nie zusammengefasst. „Ausgeschieden“ wird nicht gespeichert, sondern aus den Werten abgeleitet. Alle Funktionen in `game.js` geben einen neuen Zustand zurück und sind ohne Browser testbar.

**Layout und Drehung.** `layout.js` beschreibt je Spielerzahl ein Raster aus Zellen mit Drehwinkel. Jede Zelle enthält einen Rahmen, der um diesen Winkel gedreht wird. Der Rahmen ist ein eigener Container (Container Queries), alle Größen darin (Lebenszahl, Buttons, Panel) leiten sich von seiner tatsächlichen Breite und Höhe ab, egal wie er gedreht ist. Die oberen 30 px jedes Rahmens bleiben frei von Bedienelementen, weil das Dock in der Bildschirmmitte in die Felder hineinragt. Bei drei Reihen liegt die Mitte in den seitlich gedrehten Feldern, dort ist das Dock senkrecht. Für Rahmen unter 190 px Höhe, für 210 bis 275 px breite Rahmen bis 230 px Höhe (Seitenfelder bei 5 bis 6 Spielern: auf iPhones im Home-Bildschirm-Modus sind das 251 × 195 px, weil Statusleiste und Gestenleiste Platz brauchen) und für schmale, niedrige Rahmen gibt es verdichtete Stufen. Die E2E-Tests prüfen alle Spielerzahlen auf den Bildschirmgrößen der aktuellen iPhones (375 × 647 bis 440 × 863 px).

## Bekannte Grenzen

- **Echtes Gerät nicht getestet.** Alle Tests liefen in Chromium (Playwright, Touch- und Mobil-Emulation). Vibration und Wake Lock sind nur per Mock geprüft, iOS Safari und der Home-Bildschirm-Modus gar nicht. Die Safe-Area-Insets (Notch, Gestenleiste) sind per CSS-Variablen simuliert, der Versatz des sichtbaren Bereichs und `navigator.standalone` per Attrappe. Dass die Konfiguration (deckende Statusleiste, `viewport-fit=cover`) die verschobenen Tippflächen auf einem echten iPhone behebt und die Abstände dort passen, ist aus Berichten und Dokumentation abgeleitet, nicht gemessen.
- Commander-Schaden wird je **Besitzer** des Commanders gezählt. Partner-Commander sind deshalb nicht abgebildet: Der Schaden beider Commander desselben Besitzers zählt zusammen. Die Erweiterung wäre klein: ein zweites Feld `cmd2[quelle]` mit derselben Form, ein `slot` im Historien-Eintrag und dieselben drei Stellen in `game.js` (`isValidTarget`, `withValue`, `eliminationReasons`).
- Bei 6 Spielern gibt es sechs Kacheln (fünf Gegner und der eigene Commander). In den seitlich gedrehten Feldern, die zu niedrig für eine zweite Reihe sind, teilen sie sich die Breite: je nach Handy 32 bis 45 px breit statt 48 (und 48 px hoch).
- Die Tasten −5/+5 für Commander-Schaden gibt es nur, wo das Feld mindestens 320 px hoch ist (2 bis 4 Spieler, bei 5 bis 6 Spielern nur auf den größten Handys). Auf den kleineren Feldern zählt gedrückt halten nach einer Sekunde in 5er-Schritten, wie überall.
- Ab 21 Commander-Schaden wird das Feld als „ausgeschieden“ markiert (abgedunkelt, Totenkopf), obwohl das keine automatische Entscheidung sein soll: Es gilt wie bei Leben und Gift nur als Markierung, nichts ist gesperrt. Wer das nicht möchte, entfernt in `eliminationReasons` (`js/game.js`) die Zeile für `commander`.
- 5 und 6 Spieler brauchen Platz: Bei Handys unter etwa 390 px Breite sind Tippflächen im Zähler-Panel teils nur 38 px statt 48 px groß, weil die Felder dann nur noch rund 180 px hoch sind. Bei 2 bis 4 Spielern gibt es das Problem nicht.
- Das Zähler-Panel ersetzt beim Öffnen die Lebenszahl des Feldes. Zum Ändern des Lebens zuerst schließen.
