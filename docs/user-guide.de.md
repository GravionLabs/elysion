# Benutzerhandbuch (Grundlagen)

Kurzfassung des [englischen Benutzerhandbuchs](./user-guide.md) für die ersten Schritte. Das vollständige Handbuch bleibt englisch.

## Sprache

Elysion öffnet sich in der Sprache, die der Browser anfordert (Deutsch oder Englisch, sonst Englisch). Im Benutzermenü oben rechts
(dein Name) wechselst du die Sprache; die Wahl wird im Browser gemerkt und gilt für alle Seiten. Die Adresse ändert sich dabei nicht.

## Anmelden

Öffne Elysion im Browser (in der Demo <http://localhost>). Du wirst zur Anmeldeseite des Identity-Providers (Keycloak) geleitet; die Demo hat
die Benutzer `dev`, `dev1` und `dev2`, das Passwort ist der Benutzername. Wer zu einem Board oder Raum per E-Mail-Adresse eingeladen werden
soll, muss sich vorher einmal angemeldet haben.

## Boards und Räume

Die Startseite listet **deine Boards**: die selbst erstellten und die mit dir geteilten.

- **Neues Board** öffnet ein Formular mit dem Namen und **Starten mit**: ein leeres Board oder eine Vorlage (Brainstorming, Kanban,
  Retrospektive und eigene).
- Die **Suche** (mit `/` springst du hinein) zeigt die Boards, deren Name enthält, was du tippst; die Suche steht in der Adresse und überlebt
  ein Neuladen. **Sortieren nach** ordnet die Liste nach neuesten, Name oder zuletzt geöffnet; der Browser merkt sich deine Wahl.
- Der **Stern** auf einer Karte (oder in der Kopfleiste eines Boards) macht das Board zum **Favoriten**: Es erscheint links unter
  **Favoriten** und steht in der Liste aller Boards ganz oben. Sterne sehen nur du.
- Auf einer Karte **verschieben**, **duplizieren** und **löschen** die Symbole in der Ecke das Board (Löschen fragt vorher nach und lässt sich
  nicht rückgängig machen).
- **Räume** (die Liste links) sind gemeinsame Bereiche für die Boards eines Teams. Alle in einem Raum können seine Boards öffnen, mit ihrer
  Rolle im Raum (Eigentümer, Bearbeiter oder Betrachter).

## Das Board

Zeichne mit der Werkzeugleiste unten: Formen, Pfeile, Text, Haftnotizen, Bilder. **Bilder** (PNG, JPEG, GIF, WebP oder SVG bis 4 MB) kannst du über das Werkzeug wählen, einfügen oder auf das Board ziehen; mehrere Dateien auf einmal liegen nebeneinander an der Stelle, an der du sie fallen lässt, und sind höchstens halb so hoch wie dein Ausschnitt. Alle Personen auf dem Board sehen Änderungen sofort; ihre Cursor und
Avatare erscheinen oben rechts. **Teilen** lädt Personen per E-Mail-Adresse ein, **Vorlagen**, **Exportieren** und **Importieren** bringen
Inhalte hinein und heraus, **Hell/Dunkel** wechselt das Farbschema. Beim **Exportieren** wählst du unter **Optionen** (der Browser merkt sie sich) bei einem **PDF**, ob ein Board mit Rahmen **eine Seite pro Rahmen** ergibt (mit dem Namen des Rahmens als Überschrift) oder das ganze Board auf einer Seite liegt, sowie Seitengröße (Größe des Inhalts, A4, Letter) und Ausrichtung; **Raum exportieren** auf der Seite eines Raums macht aus allen Boards, die du lesen darfst, ein PDF (je Board eine Titelseite, dann seine Seiten); für alle Formate die Farben und den Hintergrund, bei **PNG** den Maßstab.
Inhalte hinein und heraus, **Hell/Dunkel** wechselt das Farbschema. Beim **Exportieren** wählst du unter **Optionen** (der Browser merkt sie sich) bei einem **PDF**, ob ein Board mit Rahmen **eine Seite pro Rahmen** ergibt (mit dem Namen des Rahmens als Überschrift) oder das ganze Board auf einer Seite liegt, sowie Seitengröße (Größe des Inhalts, A4, Letter) und Ausrichtung; für alle Formate die Farben und den Hintergrund, bei **PNG** den Maßstab.
Inhalte hinein und heraus (ein **PDF** wird beim Importieren Seite für Seite als Bild in je einen Rahmen "Seite 1", "Seite 2" … gelegt; die Seiten wählst du vorher aus), **Hell/Dunkel** wechselt das Farbschema.

## Kommentare

Der Knopf **Kommentare** in der Werkzeugleiste (oder die Taste **C**, wenn nicht zwei Elemente zum Verbinden ausgewählt sind) öffnet die Kommentare rechts.

1. Klicke ein **Element** oder eine leere Stelle des Boards: Der Kommentar hängt daran. Ein Kommentar an einem Element wandert mit; ein Kommentar an einer Stelle bleibt dort.
2. Schreibe den Kommentar (bis zu 2.000 Zeichen) und drücke **Kommentieren**; Strg+Enter sendet ebenfalls. Mit **@** erwähnst du jemanden: Die Liste bietet die Mitglieder des Boards an
   (die Eigentümerin sieht alle; alle anderen sehen die, die schon kommentiert haben). Eine Erwähnung erscheint als Name. Benachrichtigt wird noch niemand.
3. Eine kleine Markierung mit der Zahl der Nachrichten sitzt am Element. Ein Klick öffnet den Thread, dort kannst du **antworten** und ihn **erledigen**
   (**Wieder öffnen** holt ihn zurück). Offene Threads stehen zuerst, erledigte danach.
4. **Löschen** entfernt eine eigene Nachricht; die Eigentümerin des Boards kann jede löschen. Mit der letzten Nachricht verschwindet der Thread.

**Betrachter können kommentieren.** Die Kommentare gehören zum Board und werden mit ihm gespeichert; in PNG, SVG und `.excalidraw` erscheinen sie nicht, und **Strg+Z** macht sie nicht rückgängig.
Für ein PDF wählst du im Exportmenü **Kommentare in einem PDF**: Sie kommen als Textseiten ans Ende, die offenen zuerst. Die Option ist standardmäßig aus.
Wer eine Nachricht geschrieben hat, ist eine Regel der Oberfläche: Sie verhindert, dass man fremde Nachrichten löscht, wer aber an die Daten des Boards kommt, könnte auch als jemand anderes schreiben.

## Einen Workshop leiten

- **Timer** startet einen Countdown für alle auf dem Board (Voreinstellungen oder eigene Minuten; pausieren, eine Minute verlängern, stoppen).
- **Abstimmung** startet eine Punkte-Abstimmung: Jede Person verteilt ihre Punkte auf Elemente (auch Betrachter stimmen mit), die Moderation
  beendet die Abstimmung, und alle sehen das Ergebnis. Während sie läuft, sieht jede Person nur die eigenen Stimmen; Namen zeigt das Ergebnis
  nur, wenn du beim Start **Zeigen, wer wofür gestimmt hat** angekreuzt hast.
