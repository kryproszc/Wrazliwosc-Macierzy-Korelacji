Wymagania biznesowe
Przedmiotem inicjatywy jest utworzenie środowiska serwerowego umożliwiającego wdrożenie i uruchomienie aplikacji opracowanych w Departamencie XXXXXXXXXX, wspierających realizację zadań analitycznych, kontrolnych i raportowych. System będzie stanowił wspólne środowisko do obsługi procesów związanych z prowadzeniem kontroli, analizą danych sprawozdawczych zakładów ubezpieczeń oraz oceną i monitorowaniem modeli wykorzystywanych przez zakłady ubezpieczeń. Rozwiązanie przeznaczone jest do użytku wewnętrznego przez uprawnionych pracowników Departamentu XXXXXXXXXX. Dostęp do aplikacji będzie realizowany za pośrednictwem przeglądarki internetowej.
Wymagania funkcjonalne
W ramach środowiska planuje się wdrożenie aplikacji obejmujących następujące obszary funkcjonalne:
- Ewidencja i monitorowanie kontroli: aplikacja będzie umożliwiała prowadzenie ewidencji kontroli prowadzonych przez pracowników XXXXXXXXXX, monitorowanie przeprowadzonych kontroli, przeglądanie i zestawienia informacje o realizowanych i zrealizowanych kontrolach.
- Analiza danych sprawozdawczych QRT: aplikacja automatycznie przetwarza i wyznacza wskaźniki na podstawie sprawozdań QRT zakładów ubezpieczeń. Analizuje zmiany w czasie wskaźników, przeprowadza analizy porównawcze między zakładami oraz generuje zestawienia i wizualizację analiz.
- Ocena rezerw techniczno-ubezpieczeniowych: wczytuje dane przekazane przez zakłady ubezpieczeń, wykonuje obliczenia na zaimplementowanych modelach aktuarialnych, niezależnie odtwarza i weryfikuje wyniki modeli stosowanych przez zakłady, analizuje wpływ zmian założeń na poziom wyznaczonych rezerw.
- Ocena i monitorowanie modeli wewnętrznych: przeprowadza niezależnie obliczenia służące ocenie modeli wewnętrznych stosowanych przez zakłady ubezpieczeń, wykonuje analizy wrażliwości wyników modeli na zmiany parametrów wejściowych, monitoruje jakość i stabilność wyników modeli oraz archiwizuje wyniki przeprowadzonych ocen.

Środowisko powinno umożliwiać obsługę aplikacji wykorzystujących dane pochodzące z różnych źródeł, w szczególności plików Excel i CSV oraz danych przechowywanych w bazach Microsoft SQL Server. Wymagane jest zapewnienie komunikacji z odrębnym środowiskiem bazodanowym MS SQL Server. Środowisko powinno umożliwiać uruchamianie aplikacji webowych wykorzystujących frontend JavaScript oraz backend Python, w tym z zastosowaniem technologii kontenerowej Docker Engine i Docker Compose.
Wymagania dotyczące uprawnień: nadanie odpowiednich uprawnień administracyjnych (sudo), zapewnienie komunikacji sieciowej z serwerem Microsoft SQL Server.

Wymagania biznesowe
Przedmiotem inicjatywy jest udostępnienie środowiska bazodanowego w ramach infrastruktury Microsoft SQL Server na potrzeby Departamentu XXXXXXXXXX.
Środowisko będzie wykorzystywane do gromadzenia, przechowywania, przetwarzania i udostępniania danych wykorzystywanych w procesach analitycznych, kontrolnych i raportowych realizowanych przez Departament XXXXXXXXXX. W szczególności będzie służyło do obsługi danych pochodzących ze sprawozdawczości zakładów ubezpieczeń, w tym formularzy QRT, danych wykorzystywanych do oceny rezerw techniczno-ubezpieczeniowych i modeli wewnętrznych oraz informacji związanych z prowadzonymi kontrolami.
Wymagania funkcjonalne:
- Import danych: możliwość zasilania baz danymi pochodzącymi z różnych źródeł, w szczególności plików Excel i CSV.
- Automatyzacja procesów: możliwość wykonywania cyklicznych operacji związanych z pobieraniem, aktualizacją i przetwarzaniem danych, w tym wykorzystania zadań SQL Server Agent oraz mechanizmów ETL.
- Udostępnianie danych i raportowanie: możliwość udostępniania danych aplikacjom departamentu oraz narzędziom analitycznym i raportowym, m.in Power BI.
- Zarządzanie strukturą danych: możliwość samodzielnego tworzenia i modyfikowania tabel, widoków, procedur oraz wykonywania zapytań SQL przez uprawnionych pracowników Departamentu XXXXXXXXXX.
Integracja
Środowisko bazodanowe powinno umożliwiać komunikację z odrębnym serwerem Ubuntu Server 24.04 LTS oraz Windowsk.







