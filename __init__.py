library(dplyr)

# 1. Końcowe częstości HRG z kroku 2
# 4K_MTPL: prognoza trendu
# 4M_MTPL: surowa częstość 2023 zgodnie z konfiguracją
# 4M_GC: średnia ważona z pełnego okresu 2007–2024

czestosci_krok3 <- porownanie_krok2 %>%
  filter(HRG %in% hrg_lob4) %>%
  transmute(
    HRG,
    E_k = case_when(
      HRG == "4K_MTPL" ~ czestosc_prognoza_wazona,
      HRG == "4M_MTPL" ~ czestosc_surowa_2023,
      HRG == "4M_GC"   ~ E_gc
    )
  )

# 2. Ekspozycja planowana w roku modelowym

plan_krok3 <- plan4 %>%
  filter(YEAR == rok_modelowy) %>%
  transmute(HRG, W_k = EARNED_RISK)

stopifnot(
  setequal(plan_krok3$HRG, hrg_lob4),
  !anyDuplicated(plan_krok3$HRG),
  !anyDuplicated(czestosci_krok3$HRG),
  is.finite(E_lob4), E_lob4 > 0,
  is.finite(D_lob4), D_lob4 > 0
)

baza_krok3 <- czestosci_krok3 %>%
  left_join(plan_krok3, by = "HRG") %>%
  mutate(m_k = E_k * W_k)

stopifnot(
  all(is.finite(baza_krok3$E_k)),
  all(baza_krok3$E_k > 0),
  all(is.finite(baza_krok3$W_k)),
  all(baza_krok3$W_k > 0)
)

# 3. Kontrola relacji wymaganej w dokumentacji

W_lob_krok3 <- sum(baza_krok3$W_k)
m_lob_krok3 <- E_lob4 * W_lob_krok3
suma_m_hrg  <- sum(baza_krok3$m_k)

kontrola_krok3 <- data.frame(
  rok_modelowy = rok_modelowy,
  E_LOB = E_lob4,
  D_LOB = D_lob4,
  W_LOB = W_lob_krok3,
  oczekiwana_liczba_LOB = m_lob_krok3,
  suma_oczekiwanych_liczb_HRG = suma_m_hrg,
  roznica = suma_m_hrg - m_lob_krok3,
  roznica_wzgledna = suma_m_hrg / m_lob_krok3 - 1,
  zgodnosc = abs(suma_m_hrg - m_lob_krok3) <=
    1e-8 * max(1, abs(m_lob_krok3), abs(suma_m_hrg))
)

print(kontrola_krok3, digits = 15, row.names = FALSE)

# Udział według pierwszej postaci wzoru z dokumentacji.
# Jeżeli kontrola jest zgodna, jest też równy m_k / (E_LOB * W_LOB).

baza_krok3 <- baza_krok3 %>%
  mutate(v_k = m_k / suma_m_hrg)

# 4. Statystyki trendów
# Zachowujemy model ważony, który odtworzył wyniki Excela.

opis_trendu <- function(model) {
  s <- summary(model)
  wsp <- coef(s)

  c(
    wyraz_wolny = unname(coef(model)[1]),
    nachylenie = unname(coef(model)[2]),
    p_wyraz_wolny = wsp[1, 4],
    p_nachylenie = wsp[2, 4],
    R2 = s$r.squared
  )
}

stat_LOB <- opis_trendu(trend_lob4)

statystyki_hrg <- porownanie_krok2 %>%
  transmute(
    HRG,
    statystyki = ifelse(
      HRG == "4M_GC",
      "Nie dotyczy — brak trendu",
      paste0(
        "wyraz_wolny=", sprintf("%.15g", a_wazony),
        "; nachylenie=", sprintf("%.15g", b_wazony),
        "; p_nachylenie=", sprintf("%.15g", p_value_trendu_wazony),
        "; R2=", sprintf("%.15g", R2_wazony),
        "; prognoza_trendu=", sprintf("%.15g", czestosc_prognoza_wazona)
      )
    )
  )

baza_krok3 <- baza_krok3 %>%
  left_join(statystyki_hrg, by = "HRG")

# 5. Tabela rozkładów

poziomy <- c(seq(0.1, 0.9, 0.1), 0.95, 0.99, 0.995, 0.999)

zbuduj_wiersz <- function(j, rozklad) {

  x <- baza_krok3[j, ]
  m <- x$m_k

  if (rozklad == "Poisson") {

    D <- 1
    lam <- m
    n <- NA_real_
    p <- NA_real_
    kwantyle <- qpois(poziomy, lambda = lam)

    parametry <- sprintf("lambda=%.15g", lam)

  } else {

    # Parametryzacja R: size = n, prob = p
    # Średnia = n*(1-p)/p, wariancja = średnia/p

    D <- D_lob4

    if (D <= 1) {
      stop("Rozkład ujemny dwumianowy wymaga D_LOB > 1.")
    }

    lam <- NA_real_
    n <- m / (D - 1)
    p <- 1 / D
    kwantyle <- qnbinom(poziomy, size = n, prob = p)

    parametry <- sprintf("n=%.15g; p=%.15g", n, p)
  }

  wynik <- data.frame(
    LOB = 4,
    HRG = x$HRG,
    # NBI wskazany w pokazanej konfiguracji LOB 4
    Wybór = rozklad == "Ujemny dwumianowy",
    Rozkład = rozklad,
    `Parametry rozkładu` = parametry,
    lam = lam,
    n = n,
    p = p,
    `Trend LOB` = "liniowy",
    `Statystyki trendu LOB` = paste(
      names(stat_LOB),
      sprintf("%.15g", stat_LOB),
      sep = "=",
      collapse = "; "
    ),
    `Trend HRG` = ifelse(x$HRG == "4M_GC", "brak", "liniowy"),
    `Statystyki trendu HRG` = x$statystyki,
    `Udział HRG w LOB` = x$v_k,
    `Częstość HRG` = x$E_k,
    `Dyspersja HRG` = D,
    `Częstość LOB` = E_lob4,
    `Dyspersja LOB` = D,
    Średnia = m,
    Odchylenie = sqrt(m * D),
    check.names = FALSE
  )

  for (k in seq_along(poziomy)) {
    wynik[[as.character(poziomy[k])]] <- kwantyle[k]
  }

  wynik
}

wyniki_krok3 <- bind_rows(
  lapply(seq_len(nrow(baza_krok3)), function(j) {
    bind_rows(
      zbuduj_wiersz(j, "Poisson"),
      zbuduj_wiersz(j, "Ujemny dwumianowy")
    )
  })
)

options(digits = 15)

View(wyniki_krok3)

# Wyłącznie rozkład wskazany w konfiguracji:
wyniki_wybrane <- wyniki_krok3 %>%
  filter(Wybór)

print(as.data.frame(wyniki_wybrane), row.names = FALSE)
