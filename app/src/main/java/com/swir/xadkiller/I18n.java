package com.swir.xadkiller;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Lightweight runtime localization for xADKiller's programmatic Java UI.
 * Supported: English, Polish, Spanish, German, French.
 * Unsupported system languages fall back to English automatically.
 */
final class I18n {
    private static final int EN=0, PL=1, ES=2, DE=3, FR=4;
    private static final Map<String,String[]> M = new HashMap<>();

    static {
        // Main screen
        p("OCHRONA DNS / VPN","DNS / VPN PROTECTION","OCHRONA DNS / VPN","PROTECCIÓN DNS / VPN","DNS- / VPN-SCHUTZ","PROTECTION DNS / VPN");
        p("WYŁĄCZONA","OFF","WYŁĄCZONA","DESACTIVADA","AUS","DÉSACTIVÉE");
        p("AKTYWNA","ACTIVE","AKTYWNA","ACTIVA","AKTIV","ACTIVE");
        p("WŁĄCZ OCHRONĘ","ENABLE PROTECTION","WŁĄCZ OCHRONĘ","ACTIVAR PROTECCIÓN","SCHUTZ AKTIVIEREN","ACTIVER LA PROTECTION");
        p("WYŁĄCZ OCHRONĘ","DISABLE PROTECTION","WYŁĄCZ OCHRONĘ","DESACTIVAR PROTECCIÓN","SCHUTZ DEAKTIVIEREN","DÉSACTIVER LA PROTECTION");
        p("Warstwa 1: lokalny VPN/DNS blokuje domeny reklam, trackerów i malware.","Layer 1: local VPN/DNS blocks ad, tracker and malware domains.","Warstwa 1: lokalny VPN/DNS blokuje domeny reklam, trackerów i malware.","Capa 1: la VPN/DNS local bloquea dominios de anuncios, rastreadores y malware.","Ebene 1: Lokales VPN/DNS blockiert Werbe-, Tracker- und Malware-Domains.","Couche 1 : le VPN/DNS local bloque les domaines publicitaires, traceurs et malveillants.");
        p("Sprawdzanie…","Checking…","Sprawdzanie…","Comprobando…","Prüfe…","Vérification…");
        p("Smart detection","Smart detection","Inteligentne wykrywanie","Detección inteligente","Intelligente Erkennung","Détection intelligente");
        p("Auto-pomiń wyraźny przycisk reklamy","Auto-skip clear ad buttons","Auto-pomiń wyraźny przycisk reklamy","Omitir automáticamente botones claros de anuncio","Eindeutige Werbe-Schaltflächen automatisch überspringen","Ignorer automatiquement les boutons publicitaires explicites");
        p("Wyciszaj mocno wykrytą reklamę audio","Mute strongly detected audio ads","Wyciszaj mocno wykrytą reklamę audio","Silenciar anuncios de audio detectados con alta confianza","Sicher erkannte Audio-Werbung stummschalten","Couper les publicités audio fortement détectées");
        p("USTAWIENIA SMART ENGINE","SMART ENGINE SETTINGS","USTAWIENIA SMART ENGINE","AJUSTES DE SMART ENGINE","SMART-ENGINE-EINSTELLUNGEN","RÉGLAGES SMART ENGINE");
        p("ADAPTIVE AI • UCZENIE","ADAPTIVE AI • LEARNING","ADAPTIVE AI • UCZENIE","IA ADAPTATIVA • APRENDIZAJE","ADAPTIVE AI • LERNEN","IA ADAPTATIVE • APPRENTISSAGE");
        p("Lokalny model uczy się z Twojego feedbacku i udanych Auto-Skip. Community Intelligence pobiera tylko publiczne reguły EasyList/AdGuard — nie wykonuje obcego kodu.","The local model learns from your feedback and successful Auto-Skip actions. Community Intelligence downloads only public EasyList/AdGuard rules and never executes third-party code.","Lokalny model uczy się z Twojego feedbacku i udanych Auto-Skip. Community Intelligence pobiera tylko publiczne reguły EasyList/AdGuard — nie wykonuje obcego kodu.","El modelo local aprende de tus comentarios y de Auto-Skip exitosos. Community Intelligence descarga solo reglas públicas de EasyList/AdGuard y nunca ejecuta código externo.","Das lokale Modell lernt aus deinem Feedback und erfolgreichen Auto-Skip-Aktionen. Community Intelligence lädt nur öffentliche EasyList/AdGuard-Regeln und führt keinen fremden Code aus.","Le modèle local apprend de vos retours et des Auto-Skip réussis. Community Intelligence télécharge uniquement les règles publiques EasyList/AdGuard et n’exécute aucun code tiers.");
        p("Sprawdzanie modelu…","Checking model…","Sprawdzanie modelu…","Comprobando modelo…","Modell wird geprüft…","Vérification du modèle…");
        p("OTWÓRZ ADAPTIVE AI LAB","OPEN ADAPTIVE AI LAB","OTWÓRZ ADAPTIVE AI LAB","ABRIR ADAPTIVE AI LAB","ADAPTIVE AI LAB ÖFFNEN","OUVRIR ADAPTIVE AI LAB");
        p("PRYWATNY DNS","PRIVATE DNS","PRYWATNY DNS","DNS PRIVADO","PRIVATES DNS","DNS PRIVÉ");
        p("USTAWIENIA PRYWATNEGO DNS","PRIVATE DNS SETTINGS","USTAWIENIA PRYWATNEGO DNS","AJUSTES DE DNS PRIVADO","PRIVATE-DNS-EINSTELLUNGEN","RÉGLAGES DNS PRIVÉ");
        p("STATYSTYKI DNS","DNS STATISTICS","STATYSTYKI DNS","ESTADÍSTICAS DNS","DNS-STATISTIKEN","STATISTIQUES DNS");
        p("LISTY / ULTRA","LISTS / ULTRA","LISTY / ULTRA","LISTAS / ULTRA","LISTEN / ULTRA","LISTES / ULTRA");
        p("Tryb PRO / ULTRA","PRO / ULTRA mode","Tryb PRO / ULTRA","Modo PRO / ULTRA","PRO- / ULTRA-Modus","Mode PRO / ULTRA");
        p("AKTUALIZUJ LISTY","UPDATE LISTS","AKTUALIZUJ LISTY","ACTUALIZAR LISTAS","LISTEN AKTUALISIEREN","METTRE À JOUR LES LISTES");
        p("POBIERANIE…","DOWNLOADING…","POBIERANIE…","DESCARGANDO…","WIRD HERUNTERGELADEN…","TÉLÉCHARGEMENT…");
        p("AWARYJNY RESET CACHE / ULTRA","EMERGENCY RESET CACHE / ULTRA","AWARYJNY RESET CACHE / ULTRA","REINICIO DE EMERGENCIA CACHE / ULTRA","NOTFALL-RESET CACHE / ULTRA","RÉINITIALISATION D’URGENCE CACHE / ULTRA");
        p("WŁASNA DOMENA","CUSTOM DOMAIN","WŁASNA DOMENA","DOMINIO PERSONALIZADO","EIGENE DOMAIN","DOMAINE PERSONNALISÉ");
        p("BLOKUJ","BLOCK","BLOKUJ","BLOQUEAR","BLOCKIEREN","BLOQUER");
        p("ZEZWÓL","ALLOW","ZEZWÓL","PERMITIR","ERLAUBEN","AUTORISER");
        p("SYSTEM CONSOLE • AI / SMART / BŁĘDY","SYSTEM CONSOLE • AI / SMART / ERRORS","SYSTEM CONSOLE • AI / SMART / BŁĘDY","CONSOLA DEL SISTEMA • IA / SMART / ERRORES","SYSTEMKONSOLE • AI / SMART / FEHLER","CONSOLE SYSTÈME • IA / SMART / ERREURS");
        p("Wbudowana lista startowa.","Built-in starter list.","Wbudowana lista startowa.","Lista inicial integrada.","Integrierte Startliste.","Liste de démarrage intégrée.");
        p("⚠ Usługa Accessibility wyłączona","⚠ Accessibility service disabled","⚠ Usługa Accessibility wyłączona","⚠ Servicio de accesibilidad desactivado","⚠ Bedienungshilfe-Dienst deaktiviert","⚠ Service d’accessibilité désactivé");
        p("Usługa aktywna • detection wyłączone","Service active • detection disabled","Usługa aktywna • detection wyłączone","Servicio activo • detección desactivada","Dienst aktiv • Erkennung deaktiviert","Service actif • détection désactivée");
        p("AKTYWNY • analizuje aplikacje","ACTIVE • analyzing apps","AKTYWNY • analizuje aplikacje","ACTIVO • analizando aplicaciones","AKTIV • Apps werden analysiert","ACTIF • analyse des applications");
        p("WŁĄCZONY • oczekiwanie na zdarzenie","ENABLED • waiting for an event","WŁĄCZONY • oczekiwanie na zdarzenie","ACTIVADO • esperando un evento","AKTIVIERT • warte auf Ereignis","ACTIVÉ • en attente d’un événement");
        p("AI aktywne","AI active","AI aktywne","IA activa","AI aktiv","IA active");
        p("AI wyłączone","AI disabled","AI wyłączone","IA desactivada","AI deaktiviert","IA désactivée");
        p("Konflikt z Prywatnym DNS","Private DNS conflict","Konflikt z Prywatnym DNS","Conflicto con DNS privado","Konflikt mit privatem DNS","Conflit avec le DNS privé");
        p("Masz STRICT Private DNS. Najlepiej ustaw Automatyczny albo Wyłączony.","Private DNS is set to STRICT. Set it to Automatic or Off for best compatibility.","Masz STRICT Private DNS. Najlepiej ustaw Automatyczny albo Wyłączony.","El DNS privado está en STRICT. Para mayor compatibilidad, usa Automático o Desactivado.","Privates DNS steht auf STRICT. Für beste Kompatibilität Automatisch oder Aus wählen.","Le DNS privé est en mode STRICT. Pour une meilleure compatibilité, choisissez Automatique ou Désactivé.");
        p("Anuluj","Cancel","Anuluj","Cancelar","Abbrechen","Annuler");
        p("Ustawienia","Settings","Ustawienia","Ajustes","Einstellungen","Réglages");
        p("Uruchom mimo to","Start anyway","Uruchom mimo to","Iniciar de todos modos","Trotzdem starten","Démarrer quand même");
        p("URUCHAMIANIE…","STARTING…","URUCHAMIANIE…","INICIANDO…","WIRD GESTARTET…","DÉMARRAGE…");
        p("Błąd startu — sprawdź SYSTEM CONSOLE.","Start error — check SYSTEM CONSOLE.","Błąd startu — sprawdź SYSTEM CONSOLE.","Error de inicio — revisa SYSTEM CONSOLE.","Startfehler — SYSTEM CONSOLE prüfen.","Erreur de démarrage — consultez SYSTEM CONSOLE.");
        p("Błąd list — zobacz konsolę.","List update error — check the console.","Błąd list — zobacz konsolę.","Error de listas — revisa la consola.","Listenfehler — Konsole prüfen.","Erreur de listes — consultez la console.");
        p("Podaj poprawną domenę.","Enter a valid domain.","Podaj poprawną domenę.","Introduce un dominio válido.","Gültige Domain eingeben.","Saisissez un domaine valide.");
        p("Reset cache / ULTRA?","Reset cache / ULTRA?","Reset cache / ULTRA?","¿Restablecer caché / ULTRA?","Cache / ULTRA zurücksetzen?","Réinitialiser le cache / ULTRA ?");
        p("Usunie pobraną dużą listę i wyłączy ULTRA. Własne reguły zostaną zachowane.","This removes the downloaded large list and disables ULTRA. Your custom rules will be kept.","Usunie pobraną dużą listę i wyłączy ULTRA. Własne reguły zostaną zachowane.","Esto elimina la lista grande descargada y desactiva ULTRA. Tus reglas personalizadas se conservarán.","Die große heruntergeladene Liste wird entfernt und ULTRA deaktiviert. Eigene Regeln bleiben erhalten.","Cela supprime la grande liste téléchargée et désactive ULTRA. Vos règles personnalisées seront conservées.");
        p("Cache zresetowany.","Cache reset.","Cache zresetowany.","Caché restablecida.","Cache zurückgesetzt.","Cache réinitialisé.");
        p("Włącz „xADKiller Smart Ad Engine”.","Enable “xADKiller Smart Ad Engine”.","Włącz „xADKiller Smart Ad Engine”.","Activa «xADKiller Smart Ad Engine».","„xADKiller Smart Ad Engine“ aktivieren.","Activez « xADKiller Smart Ad Engine ».");
        p("Nie można otworzyć linku.","Unable to open the link.","Nie można otworzyć linku.","No se puede abrir el enlace.","Link kann nicht geöffnet werden.","Impossible d’ouvrir le lien.");

        // Adaptive / benchmark lab
        p("JAK TO DZIAŁA","HOW IT WORKS","JAK TO DZIAŁA","CÓMO FUNCIONA","SO FUNKTIONIERT ES","COMMENT ÇA MARCHE");
        p("Model uczy się na telefonie. Zapamiętuje zahashowane cechy interfejsu, nie pełny tekst ekranu. Community/Benchmark AI pobiera publiczne reguły i strony testowe, wyciąga tylko krótkie sygnały reklamowe i nigdy nie wykonuje ich kodu JavaScript.","The model learns on your phone. It stores hashed interface features, not full screen text. Community/Benchmark AI downloads public rules and test pages, extracts only short ad-related signals, and never executes their JavaScript.","Model uczy się na telefonie. Zapamiętuje zahashowane cechy interfejsu, nie pełny tekst ekranu. Community/Benchmark AI pobiera publiczne reguły i strony testowe, wyciąga tylko krótkie sygnały reklamowe i nigdy nie wykonuje ich kodu JavaScript.","El modelo aprende en el teléfono. Guarda características de interfaz con hash, no el texto completo de la pantalla. Community/Benchmark AI descarga reglas públicas y páginas de prueba, extrae solo señales cortas relacionadas con anuncios y nunca ejecuta su JavaScript.","Das Modell lernt auf dem Telefon. Es speichert gehashte UI-Merkmale, nicht den vollständigen Bildschirmtext. Community/Benchmark AI lädt öffentliche Regeln und Testseiten, extrahiert nur kurze Werbesignale und führt deren JavaScript niemals aus.","Le modèle apprend sur le téléphone. Il stocke des caractéristiques d’interface hachées, pas le texte complet de l’écran. Community/Benchmark AI télécharge des règles publiques et des pages de test, extrait seulement de courts signaux publicitaires et n’exécute jamais leur JavaScript.");
        p("TRYB UCZENIA","LEARNING MODE","TRYB UCZENIA","MODO DE APRENDIZAJE","LERNMODUS","MODE D’APPRENTISSAGE");
        p("Adaptive AI aktywne","Adaptive AI enabled","Adaptive AI aktywne","Adaptive AI activa","Adaptive AI aktiv","Adaptive AI active");
        p("Ucz się lekko po udanym Auto-Skip","Learn lightly after a successful Auto-Skip","Ucz się lekko po udanym Auto-Skip","Aprender ligeramente tras un Auto-Skip exitoso","Nach erfolgreichem Auto-Skip leicht lernen","Apprendre légèrement après un Auto-Skip réussi");
        p("MODEL LOKALNY","LOCAL MODEL","MODEL LOKALNY","MODELO LOCAL","LOKALES MODELL","MODÈLE LOCAL");
        p("✓ TO BYŁA REKLAMA","✓ THAT WAS AN AD","✓ TO BYŁA REKLAMA","✓ ESO ERA UN ANUNCIO","✓ DAS WAR WERBUNG","✓ C’ÉTAIT UNE PUBLICITÉ");
        p("✕ FAŁSZYWY ALARM","✕ FALSE POSITIVE","✕ FAŁSZYWY ALARM","✕ FALSO POSITIVO","✕ FEHLALARM","✕ FAUX POSITIF");
        p("Naciśnij odpowiedni przycisk zaraz po powrocie z testowanej aplikacji. xADKiller uczy wtedy ostatni ekran widziany przez Smart Engine.","Press the appropriate button immediately after returning from the tested app. xADKiller will train on the last screen seen by Smart Engine.","Naciśnij odpowiedni przycisk zaraz po powrocie z testowanej aplikacji. xADKiller uczy wtedy ostatni ekran widziany przez Smart Engine.","Pulsa el botón adecuado justo después de volver de la aplicación probada. xADKiller aprenderá de la última pantalla vista por Smart Engine.","Direkt nach der Rückkehr aus der getesteten App den passenden Button drücken. xADKiller lernt dann vom letzten durch Smart Engine gesehenen Bildschirm.","Appuyez sur le bouton approprié juste après être revenu de l’application testée. xADKiller apprendra du dernier écran vu par Smart Engine.");
        p("RESETUJ LOKALNE UCZENIE","RESET LOCAL LEARNING","RESETUJ LOKALNE UCZENIE","RESTABLECER APRENDIZAJE LOCAL","LOKALES LERNEN ZURÜCKSETZEN","RÉINITIALISER L’APPRENTISSAGE LOCAL");
        p("Źródła: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com i SuperAdBlockTest.com. Pobieramy tylko publiczny tekst/reguły i wyciągamy z nich identyfikatory reklamowe. Same strony testowe nigdy nie są automatycznie blokowane.","Sources: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com and SuperAdBlockTest.com. We download only public text/rules and extract ad identifiers from them. The benchmark sites themselves are never automatically blocked.","Źródła: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com i SuperAdBlockTest.com. Pobieramy tylko publiczny tekst/reguły i wyciągamy z nich identyfikatory reklamowe. Same strony testowe nigdy nie są automatycznie blokowane.","Fuentes: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com y SuperAdBlockTest.com. Solo descargamos texto/reglas públicas y extraemos identificadores publicitarios. Los sitios de prueba nunca se bloquean automáticamente.","Quellen: EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com und SuperAdBlockTest.com. Es werden nur öffentliche Texte/Regeln geladen und Werbe-IDs extrahiert. Die Testseiten selbst werden nie automatisch blockiert.","Sources : EasyList, AdGuard Filters, Turtlecute AdBlock Test, AdBlock-Tester.com et SuperAdBlockTest.com. Seuls les textes/règles publics sont téléchargés et les identifiants publicitaires en sont extraits. Les sites de test eux-mêmes ne sont jamais bloqués automatiquement.");
        p("AKTUALIZUJ COMMUNITY + BENCHMARK AI","UPDATE COMMUNITY + BENCHMARK AI","AKTUALIZUJ COMMUNITY + BENCHMARK AI","ACTUALIZAR COMMUNITY + BENCHMARK AI","COMMUNITY + BENCHMARK AI AKTUALISIEREN","METTRE À JOUR COMMUNITY + BENCHMARK AI");
        p("BENCHMARK LAB • 3 TESTY","BENCHMARK LAB • 3 TESTS","BENCHMARK LAB • 3 TESTY","BENCHMARK LAB • 3 PRUEBAS","BENCHMARK LAB • 3 TESTS","BENCHMARK LAB • 3 TESTS");
        p("Uruchom test w przeglądarce przy aktywnym VPN/DNS i Smart Engine. Wynik traktujemy jako diagnostykę — nie uczymy modelu na ślepo tylko po to, żeby nabić procent.","Run the test in your browser with VPN/DNS and Smart Engine active. The score is diagnostic — we do not blindly train the model just to inflate a percentage.","Uruchom test w przeglądarce przy aktywnym VPN/DNS i Smart Engine. Wynik traktujemy jako diagnostykę — nie uczymy modelu na ślepo tylko po to, żeby nabić procent.","Ejecuta la prueba en el navegador con VPN/DNS y Smart Engine activos. El resultado es diagnóstico: no entrenamos el modelo a ciegas solo para subir un porcentaje.","Test im Browser mit aktivem VPN/DNS und Smart Engine ausführen. Das Ergebnis dient der Diagnose — wir trainieren das Modell nicht blind nur für einen höheren Prozentwert.","Lancez le test dans le navigateur avec VPN/DNS et Smart Engine actifs. Le score sert au diagnostic — nous n’entraînons pas aveuglément le modèle uniquement pour augmenter un pourcentage.");
        p("UCZ Z TYCH ŹRÓDEŁ TERAZ","LEARN FROM THESE SOURCES NOW","UCZ Z TYCH ŹRÓDEŁ TERAZ","APRENDER DE ESTAS FUENTES AHORA","JETZT AUS DIESEN QUELLEN LERNEN","APPRENDRE DE CES SOURCES MAINTENANT");
        p("JAK NAJSZYBCIEJ UCZYĆ","FASTEST WAY TO TRAIN","JAK NAJSZYBCIEJ UCZYĆ","CÓMO ENTRENAR MÁS RÁPIDO","SO LERNST DU AM SCHNELLSTEN","COMMENT ENTRAÎNER PLUS VITE");
        p("← WRÓĆ DO xADKILLER","← BACK TO xADKILLER","← WRÓĆ DO xADKILLER","← VOLVER A xADKILLER","← ZURÜCK ZU xADKILLER","← RETOUR À xADKILLER");
        p("UCZENIE Z 6 ŹRÓDEŁ…","LEARNING FROM 6 SOURCES…","UCZENIE Z 6 ŹRÓDEŁ…","APRENDIENDO DE 6 FUENTES…","LERNE AUS 6 QUELLEN…","APPRENTISSAGE DEPUIS 6 SOURCES…");
        p("Błąd aktualizacji — zobacz SYSTEM CONSOLE.","Update error — check SYSTEM CONSOLE.","Błąd aktualizacji — zobacz SYSTEM CONSOLE.","Error de actualización — revisa SYSTEM CONSOLE.","Aktualisierungsfehler — SYSTEM CONSOLE prüfen.","Erreur de mise à jour — consultez SYSTEM CONSOLE.");
        p("Nie można otworzyć strony testowej.","Unable to open the test page.","Nie można otworzyć strony testowej.","No se puede abrir la página de prueba.","Testseite kann nicht geöffnet werden.","Impossible d’ouvrir la page de test.");
        p("Zresetować Adaptive AI?","Reset Adaptive AI?","Zresetować Adaptive AI?","¿Restablecer Adaptive AI?","Adaptive AI zurücksetzen?","Réinitialiser Adaptive AI ?");
        p("Usunie tylko lokalnie nauczone wagi i feedback. Listy DNS i Community/Benchmark AI zostaną zachowane.","Only locally learned weights and feedback will be removed. DNS and Community/Benchmark AI lists will be kept.","Usunie tylko lokalnie nauczone wagi i feedback. Listy DNS i Community/Benchmark AI zostaną zachowane.","Solo se eliminarán los pesos aprendidos localmente y los comentarios. Se conservarán las listas DNS y Community/Benchmark AI.","Nur lokal gelernte Gewichte und Feedback werden entfernt. DNS- und Community/Benchmark-AI-Listen bleiben erhalten.","Seuls les poids appris localement et les retours seront supprimés. Les listes DNS et Community/Benchmark AI seront conservées.");
        p("Model lokalny zresetowany.","Local model reset.","Model lokalny zresetowany.","Modelo local restablecido.","Lokales Modell zurückgesetzt.","Modèle local réinitialisé.");

        // System console
        p("STAN SYSTEMU","SYSTEM STATUS","STAN SYSTEMU","ESTADO DEL SISTEMA","SYSTEMSTATUS","ÉTAT DU SYSTÈME");
        p("Prywatny DNS: sprawdzanie…","Private DNS: checking…","Prywatny DNS: sprawdzanie…","DNS privado: comprobando…","Privates DNS: wird geprüft…","DNS privé : vérification…");
        p("Sieć: sprawdzanie…","Network: checking…","Sieć: sprawdzanie…","Red: comprobando…","Netzwerk: wird geprüft…","Réseau : vérification…");
        p("Smart Engine: sprawdzanie…","Smart Engine: checking…","Smart Engine: sprawdzanie…","Smart Engine: comprobando…","Smart Engine: wird geprüft…","Smart Engine : vérification…");
        p("TEST SIECI","NETWORK TEST","TEST SIECI","PRUEBA DE RED","NETZWERKTEST","TEST RÉSEAU");
        p("LOGOWANIE","LOGGING","LOGOWANIE","REGISTRO","PROTOKOLLIERUNG","JOURNALISATION");
        p("Pełny log DNS (również dozwolone zapytania)","Full DNS log (including allowed queries)","Pełny log DNS (również dozwolone zapytania)","Registro DNS completo (incluidas consultas permitidas)","Vollständiges DNS-Protokoll (auch erlaubte Anfragen)","Journal DNS complet (y compris les requêtes autorisées)");
        p("Smart Engine zapisuje tutaj AD_DETECTED, AUTO-SKIP, MUTE, RESTORE i błędy. Log pozostaje lokalnie na telefonie.","Smart Engine records AD_DETECTED, AUTO-SKIP, MUTE, RESTORE and errors here. The log stays locally on your phone.","Smart Engine zapisuje tutaj AD_DETECTED, AUTO-SKIP, MUTE, RESTORE i błędy. Log pozostaje lokalnie na telefonie.","Smart Engine registra aquí AD_DETECTED, AUTO-SKIP, MUTE, RESTORE y errores. El registro permanece local en el teléfono.","Smart Engine protokolliert hier AD_DETECTED, AUTO-SKIP, MUTE, RESTORE und Fehler. Das Protokoll bleibt lokal auf dem Telefon.","Smart Engine enregistre ici AD_DETECTED, AUTO-SKIP, MUTE, RESTORE et les erreurs. Le journal reste local sur le téléphone.");
        p("WSZYSTKO","ALL","WSZYSTKO","TODO","ALLES","TOUT");
        p("TYLKO BŁĘDY","ERRORS ONLY","TYLKO BŁĘDY","SOLO ERRORES","NUR FEHLER","ERREURS UNIQUEMENT");
        p("ODŚWIEŻ","REFRESH","ODŚWIEŻ","ACTUALIZAR","AKTUALISIEREN","ACTUALISER");
        p("KOPIUJ RAPORT","COPY REPORT","KOPIUJ RAPORT","COPIAR INFORME","BERICHT KOPIEREN","COPIER LE RAPPORT");
        p("WYCZYŚĆ","CLEAR","WYCZYŚĆ","BORRAR","LÖSCHEN","EFFACER");
        p("Wyczyścić SYSTEM CONSOLE?","Clear SYSTEM CONSOLE?","Wyczyścić SYSTEM CONSOLE?","¿Borrar SYSTEM CONSOLE?","SYSTEM CONSOLE löschen?","Effacer SYSTEM CONSOLE ?");
        p("Usunie lokalny log diagnostyczny, ale nie log blokad DNS.","This removes the local diagnostic log, but not the DNS block log.","Usunie lokalny log diagnostyczny, ale nie log blokad DNS.","Esto elimina el registro de diagnóstico local, pero no el registro de bloqueos DNS.","Dies entfernt das lokale Diagnoseprotokoll, aber nicht das DNS-Blockierungsprotokoll.","Cela supprime le journal de diagnostic local, mais pas le journal des blocages DNS.");
        p("Zdarzenia","EVENTS","ZDARZENIA","EVENTOS","EREIGNISSE","ÉVÉNEMENTS");
        p("ZDARZENIA","EVENTS","ZDARZENIA","EVENTOS","EREIGNISSE","ÉVÉNEMENTS");
        p("Brak wpisów dla wybranego filtra.","No entries for the selected filter.","Brak wpisów dla wybranego filtra.","No hay entradas para el filtro seleccionado.","Keine Einträge für den gewählten Filter.","Aucune entrée pour le filtre sélectionné.");
        p("Testuję DNS i internet…","Testing DNS and internet…","Testuję DNS i internet…","Probando DNS e internet…","DNS und Internet werden getestet…","Test du DNS et d’Internet…");
        p("Test DNS nieudany — zobacz konsolę.","DNS test failed — check the console.","Test DNS nieudany — zobacz konsolę.","La prueba DNS falló — revisa la consola.","DNS-Test fehlgeschlagen — Konsole prüfen.","Échec du test DNS — consultez la console.");
        p("Raport skopiowany.","Report copied.","Raport skopiowany.","Informe copiado.","Bericht kopiert.","Rapport copié.");

        // Notification / misc
        p("xADKiller aktywny","xADKiller active","xADKiller aktywny","xADKiller activo","xADKiller aktiv","xADKiller actif");
        p("Wyłącz","Disable","Wyłącz","Desactivar","Deaktivieren","Désactiver");
        p("Lokalna ochrona DNS przed reklamami, trackerami i złośliwymi domenami","Local DNS protection against ads, trackers and malicious domains","Lokalna ochrona DNS przed reklamami, trackerami i złośliwymi domenami","Protección DNS local contra anuncios, rastreadores y dominios maliciosos","Lokaler DNS-Schutz vor Werbung, Trackern und schädlichen Domains","Protection DNS locale contre les publicités, traceurs et domaines malveillants");

        // Adaptive feedback result messages
        p("Brak ostatniej obserwacji Smart Engine.","No recent Smart Engine observation.","Brak ostatniej obserwacji Smart Engine.","No hay una observación reciente de Smart Engine.","Keine aktuelle Smart-Engine-Beobachtung.","Aucune observation récente de Smart Engine.");
        p("Ostatnia obserwacja nie zawiera cech do nauki.","The latest observation contains no features to learn from.","Ostatnia obserwacja nie zawiera cech do nauki.","La última observación no contiene características para aprender.","Die letzte Beobachtung enthält keine lernbaren Merkmale.","La dernière observation ne contient aucune caractéristique à apprendre.");
    }

    private I18n() {}

    private static void p(String source,String en,String pl,String es,String de,String fr){M.put(source,new String[]{en,pl,es,de,fr});}

    static String language(Context c){
        String raw="en";
        try {
            Configuration cfg=c.getResources().getConfiguration();
            if(Build.VERSION.SDK_INT>=24 && !cfg.getLocales().isEmpty()) raw=cfg.getLocales().get(0).getLanguage();
            else if(cfg.locale!=null) raw=cfg.locale.getLanguage();
        } catch(Throwable ignored) {}
        raw=raw==null?"en":raw.toLowerCase(Locale.ROOT);
        if(raw.equals("pl")||raw.equals("es")||raw.equals("de")||raw.equals("fr")||raw.equals("en")) return raw;
        return "en";
    }

    static String rawSystemLanguage(Context c){
        try {
            Configuration cfg=c.getResources().getConfiguration();
            Locale l=Build.VERSION.SDK_INT>=24&&!cfg.getLocales().isEmpty()?cfg.getLocales().get(0):cfg.locale;
            return l==null?"en":l.toLanguageTag();
        } catch(Throwable t){return "en";}
    }

    static String languageName(Context c){
        switch(language(c)){
            case "pl": return "Polski";
            case "es": return "Español";
            case "de": return "Deutsch";
            case "fr": return "Français";
            default: return "English";
        }
    }

    static String languageStatus(Context c){
        String raw=rawSystemLanguage(c);String chosen=language(c);boolean fallback=!raw.toLowerCase(Locale.ROOT).startsWith(chosen);
        if(fallback) return "Language: English • fallback from "+raw;
        switch(chosen){
            case "pl": return "Język: Polski • automatycznie";
            case "es": return "Idioma: Español • automático";
            case "de": return "Sprache: Deutsch • automatisch";
            case "fr": return "Langue : Français • automatique";
            default: return "Language: English • automatic";
        }
    }

    private static int idx(Context c){String l=language(c);if("pl".equals(l))return PL;if("es".equals(l))return ES;if("de".equals(l))return DE;if("fr".equals(l))return FR;return EN;}

    static String t(Context c,String source){
        if(source==null)return "";
        String[] row=M.get(source);
        if(row!=null)return row[idx(c)];
        return dynamic(c,source);
    }

    /** Translates common dynamic labels while preserving numbers, domains and technical data. */
    static String dynamic(Context c,String s){
        if(s==null||s.isEmpty())return s;
        if("pl".equals(language(c)))return s;
        String out=s;
        out=r(c,out,"Nazwa hosta / STRICT","Hostname / STRICT","Nombre de host / STRICT","Hostname / STRICT","Nom d’hôte / STRICT");
        out=r(c,out,"Wyłączony","Off","Desactivado","Aus","Désactivé");
        out=r(c,out,"Automatyczny","Automatic","Automático","Automatisch","Automatique");
        out=r(c,out,"aktywny","active","activo","aktiv","actif");
        out=r(c,out,"Ostatnia blokada:","Last block:","Último bloqueo:","Letzte Blockierung:","Dernier blocage :");
        out=r(c,out,"Ostatnia aktualizacja:","Last update:","Última actualización:","Letzte Aktualisierung:","Dernière mise à jour :");
        out=r(c,out," zablokowanych"," blocked"," bloqueados"," blockiert"," bloqués");
        out=r(c,out," zapytań"," queries"," consultas"," Anfragen"," requêtes");
        out=r(c,out," domen na liście"," domains in list"," dominios en la lista"," Domains in der Liste"," domaines dans la liste");
        out=r(c,out," wykryć"," detections"," detecciones"," Erkennungen"," détections");
        out=r(c,out," akcji"," actions"," acciones"," Aktionen"," actions");
        out=r(c,out," cech"," features"," características"," Merkmale"," caractéristiques");
        out=r(c,out,"Prywatny DNS:","Private DNS:","DNS privado:","Privates DNS:","DNS privé :");
        out=r(c,out,"Sieć:","Network:","Red:","Netzwerk:","Réseau :");
        out=r(c,out,"brak aktywnej sieci","no active network","sin red activa","kein aktives Netzwerk","aucun réseau actif");
        out=r(c,out,"dostępna","available","disponible","verfügbar","disponible");
        out=r(c,out,"brak","none","ninguno","keine","aucun");
        out=r(c,out,"wpisów","entries","entradas","Einträge","entrées");
        out=r(c,out,"maks. 500 pokazanych","max. 500 shown","máx. 500 mostradas","max. 500 angezeigt","500 max. affichées");
        out=r(c,out,"filtr:","filter:","filtro:","Filter:","filtre :");
        out=r(c,out,"Próbki feedbacku:","Feedback samples:","Muestras de feedback:","Feedback-Beispiele:","Échantillons de retour :");
        out=r(c,out,"reklamy:","ads:","anuncios:","Werbung:","publicités :");
        out=r(c,out,"Aktywne nauczone cechy:","Active learned features:","Características aprendidas activas:","Aktive gelernte Merkmale:","Caractéristiques apprises actives :");
        out=r(c,out,"Ostatnia obserwacja:","Latest observation:","Última observación:","Letzte Beobachtung:","Dernière observation :");
        out=r(c,out,"nieznana aplikacja","unknown app","aplicación desconocida","unbekannte App","application inconnue");
        out=r(c,out,"Sygnały AI:","AI signals:","Señales IA:","AI-Signale:","Signaux IA :");
        out=r(c,out,"źródła:","sources:","fuentes:","Quellen:","sources :");
        out=r(c,out,"aktualizacja:","updated:","actualización:","aktualisiert:","mise à jour :");
        out=r(c,out,"sygnałów","signals","señales","Signale","signaux");
        out=r(c,out,"Nauczono: to była reklama","Learned: that was an ad","Aprendido: era un anuncio","Gelernt: Das war Werbung","Appris : c’était une publicité");
        out=r(c,out,"Nauczono: fałszywy alarm","Learned: false positive","Aprendido: falso positivo","Gelernt: Fehlalarm","Appris : faux positif");
        out=r(c,out,"Ochrona reklam/trackingu • zablokowano:","Ad/tracker protection • blocked:","Protección contra anuncios/rastreadores • bloqueados:","Werbe-/Tracker-Schutz • blockiert:","Protection pubs/traceurs • bloqués :");
        out=r(c,out,"DNS działa","DNS works","DNS funciona","DNS funktioniert","DNS fonctionne");
        return out;
    }

    private static String r(Context c,String input,String pl,String en,String es,String de,String fr){
        if(!input.contains(pl))return input;
        int i=idx(c);String[] a={en,pl,es,de,fr};return input.replace(pl,a[i]);
    }

    static void apply(Context c, View root){
        if(root==null)return;
        if(root instanceof TextView){
            TextView tv=(TextView)root;
            CharSequence cs=tv.getText();
            if(cs!=null && cs.length()>0){String old=cs.toString();String n=t(c,old);if(!old.equals(n))tv.setText(n);}
            CharSequence hint=tv.getHint();
            if(hint!=null && hint.length()>0){String old=hint.toString();String n=t(c,old);if(!old.equals(n))tv.setHint(n);}
        }
        if(root instanceof ViewGroup){ViewGroup g=(ViewGroup)root;for(int i=0;i<g.getChildCount();i++)apply(c,g.getChildAt(i));}
    }
}
