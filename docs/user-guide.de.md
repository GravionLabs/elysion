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
Avatare erscheinen oben rechts. **Teilen** lädt Personen nach **Name oder E-Mail-Adresse** (die passenden Personen erscheinen in einer Liste) oder mit einem **Einladungslink** (Rolle, Gültigkeit von 1 Stunde bis 30 Tagen, optional eine Höchstzahl an Benutzungen; die Adresse wird nur beim Erstellen angezeigt, **Widerrufen** beendet den Link sofort) ein, **Vorlagen**, **Exportieren** und **Importieren** bringen
Inhalte hinein und heraus, **Hell/Dunkel** wechselt das Farbschema. Beim **Exportieren** wählst du unter **Optionen** (der Browser merkt sie sich) bei einem **PDF**, ob ein Board mit Rahmen **eine Seite pro Rahmen** ergibt (mit dem Namen des Rahmens als Überschrift) oder das ganze Board auf einer Seite liegt, sowie Seitengröße (Größe des Inhalts, A4, Letter) und Ausrichtung; **Raum exportieren** auf der Seite eines Raums macht aus allen Boards, die du lesen darfst, ein PDF (je Board eine Titelseite, dann seine Seiten); für alle Formate die Farben und den Hintergrund, bei **PNG** den Maßstab.
Inhalte hinein und heraus, **Hell/Dunkel** wechselt das Farbschema. Beim **Exportieren** wählst du unter **Optionen** (der Browser merkt sie sich) bei einem **PDF**, ob ein Board mit Rahmen **eine Seite pro Rahmen** ergibt (mit dem Namen des Rahmens als Überschrift) oder das ganze Board auf einer Seite liegt, sowie Seitengröße (Größe des Inhalts, A4, Letter) und Ausrichtung; für alle Formate die Farben und den Hintergrund, bei **PNG** den Maßstab.
Inhalte hinein und heraus (ein **PDF** wird beim Importieren Seite für Seite als Bild in je einen Rahmen "Seite 1", "Seite 2" … gelegt; die Seiten wählst du vorher aus), **Hell/Dunkel** wechselt das Farbschema.

Im Teilen-Fenster zeigt **Verlauf** (nur für Besitzer; er wird erst beim Öffnen geladen) die letzten 20 Änderungen des Boards oder Raums: wer wem welche Rolle gegeben oder genommen hat und welche Einladungslinks erstellt, widerrufen oder benutzt wurden.

**Verbindung weg?** Arbeite einfach weiter: Die Statusanzeige oben sagt **Offline**, und nach einigen Sekunden weist eine Leiste darauf hin, dass deine
Änderungen **auf diesem Gerät gesichert** und gesendet werden, sobald die Verbindung wieder da ist. Auch wenn du den Tab dazwischen schließt oder neu lädst,
sind sie noch da: Öffne das Board wieder, wenn du online bist, dann werden sie gesendet. Danach sagt die Leiste, wie viele Änderungen gesendet wurden; haben
zwei Personen dasselbe geändert, werden die Änderungen ohne Rückfrage zusammengeführt. Nach fünf Minuten bietet die Leiste **Kopie herunterladen** an, falls du
lieber selbst eine Datei behalten willst. Die Kopie auf deinem Gerät wird beim Abmelden gelöscht; melde dich auf einem gemeinsam genutzten Rechner ab, wenn du fertig bist.

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

## Administration

Wer die Instanz administriert (die Rolle `elysion-admin` beim Identitätsanbieter), findet **Administration** im Menü unter dem eigenen Namen. Sie zeigt Namen, Zahlen und Rollen, nie, was auf einem Board steht.

- **Übersicht:** wie viele Personen, Gruppen, Räume und Boards es gibt und über welchen Identitätsanbieter man sich anmeldet.
- **Personen:** Suche nach Name oder E-Mail; ein Name öffnet die Räume und Boards, die die Person direkt hat, mit ihren Rollen.
- **Gruppen:** Eine _lokale_ Gruppe wird hier angelegt und gepflegt (**Neue Gruppe**, **Umbenennen**, Mitglieder hinzufügen und entfernen). Eine _verknüpfte_ Gruppe gehört dem Identitätsanbieter: Mit **Verknüpfen** bindest du eine lokale Gruppe über ihre ID an eine Gruppe des Anbieters, ihre Mitglieder folgen dann dem Anbieter, sobald sich jemand anmeldet; **Lösen** macht sie wieder lokal und behält die Mitglieder. **Löschen** sagt, wie viele Räume die Rolle verlieren, die die Gruppe ihnen gegeben hat. Hat dein Betreiber **Microsoft Graph** eingeschaltet, zeigt die Seite, wann die Gruppen zuletzt aus dem Verzeichnis gelesen wurden; eine verknüpfte Gruppe zeigt dann auch die Leute, die **auf ihre erste Anmeldung warten** (sie werden Mitglieder, sobald sie sich mit dieser Adresse anmelden).
- **Räume:** Name, Besitzer und Zahlen; keine Board-Namen.
- **Eine Person deaktivieren:** Öffne sie unter **Personen** und wähle **Deaktivieren…**. Sie wird ab dann überall abgewiesen, beim Hinzufügen nicht mehr
  angeboten und bleibt in den Mitgliederlisten als _deaktiviert_ stehen. Elysion kann das Konto beim Identitätsanbieter nicht abschalten: Tu das dort
  ebenfalls, sonst kann sich die Person dort weiter anmelden. **Reaktivieren** bringt alles zurück.
- **Übergeben:** Für eine deaktivierte Person, der Boards oder Räume gehören, gibt **Übergeben** alle an jemand anderen, der damit ihr Eigentümer wird; die
  Person, die gegangen ist, behält nichts, und du bekommst auch keine Rolle.
- **Audit:** wer Zugriff gegeben oder genommen hat, neueste zuerst, mit der Person, die es getan hat. Ein Klick auf ein Board, einen Raum, eine
  Gruppe oder eine Person in einer Zeile filtert danach; dazu lässt sich ein Zeitraum wählen. Ein Eintrag enthält IDs, Rollen und Zahlen, nie den
  Inhalt eines Boards. Einträge werden ein Jahr aufbewahrt (`AUDIT_RETENTION_DAYS`).

Alle anderen sehen unter dieser Adresse „Du bist kein Administrator“.

## Einen Workshop leiten

- **Timer** startet einen Countdown für alle auf dem Board (Voreinstellungen oder eigene Minuten; pausieren, eine Minute verlängern, stoppen).
- **Abstimmung** startet eine Punkte-Abstimmung: Jede Person verteilt ihre Punkte auf Elemente (auch Betrachter stimmen mit), die Moderation
  beendet die Abstimmung, und alle sehen das Ergebnis. Während sie läuft, sieht jede Person nur die eigenen Stimmen; Namen zeigt das Ergebnis
  nur, wenn du beim Start **Zeigen, wer wofür gestimmt hat** angekreuzt hast.
