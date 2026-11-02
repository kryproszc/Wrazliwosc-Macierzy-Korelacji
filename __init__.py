library(dplyr)

# ============================================================
# 1. Dane dla trzech HRG
# ============================================================

hrg_lob4 <- c("4K_MTPL", "4M_GC", "4M_MTPL")

stopifnot(
  length(E_lob4) == 1L,
  length(D_lob4) == 1L,
  is.finite(E_lob4),
  E_lob4 > 0,
  is.finite(D_lob4),
  D_lob4 > 1
)

# Końcowe częstości ustalone w kroku 2.
# E_gc musi być wynikiem obliczenia dla pełnych lat 2007–2024.

czestosci <- porownanie_krok2 %>%
  filter(HRG %in% hrg_lob4) %>%
  transmute(
    HRG,
    E_k = case_when(
      HRG == "4K_MTPL" ~ czestosc_prognoza_wazona,
      HRG == "4M_GC"   ~ E_gc,
      HRG == "4M_MTPL" ~ czestosc_surowa_2023
    )
  )

ekspozycje <- plan4 %>%
  filter(YEAR == rok_modelowy, HRG %in% hrg_lob4) %>%
  transmute(HRG, W_k = EARNED_RISK)

stopifnot(
  setequal(czestosci$HRG, hrg_lob4),
  setequal(ekspozycje$HRG, hrg_lob4),
  !anyDuplicated(czestosci$HRG),
  !anyDuplicated(ekspozycje$HRG)
)

baza_krok3 <- czestosci %>%
  left_join(ekspozycje, by = "HRG") %>%
  mutate(
    m_k = E_k * W_k,
    v_k = m_k / sum(m_k)
  ) %>%
  arrange(match(HRG, hrg_lob4))

stopifnot(
  all(is.finite(baza_krok3$E_k)),
  all(baza_krok3$E_k > 0),
  all(is.finite(baza_krok3$W_k)),
  all(baza_krok3$W_k > 0)
)

# ============================================================
# 2. Statystyki trendów
# Wyraz wolny i nachylenie nazywamy wprost.
# Nie zakładamy, że litery a/b w Excelu oznaczają to samo.
# ============================================================

formatuj <- function(x) {
  paste(sprintf("%.15g", x), collapse = ", ")
}

opis_modelu <- function(model, rok_prognozy) {

  s <- summary(model)
  wsp <- coef(s)

  prognoza <- as.numeric(
    predict(model, newdata = data.frame(i = rok_prognozy))
  )

  paste0(
    "wyraz_wolny=", formatuj(coef(model)[1]),
    "; nachylenie=", formatuj(coef(model)[2]),
    "; pvalues=[", formatuj(wsp[, 4]), "]",
    "; r2=", formatuj(s$r.squared),
    "; rok_prognozy=", rok_prognozy,
    "; pred=", formatuj(prognoza),
    "; liczba_obserwacji=", nobs(model)
  )
}

statystyki_LOB <- opis_modelu(trend_lob4, rok_modelowy)

statystyki_HRG <- setNames(
  lapply(hrg_lob4, function(hrg) {

    if (hrg == "4M_GC") {
      return("Brak trendu; średnia ważona za lata 2007–2024")
    }

    dane <- dane_krok2 %>%
      filter(
        HRG == hrg,
        i >= 2007,
        i <= 2024
      ) %>%
      arrange(i)

    stopifnot(
      !anyDuplicated(dane$i),
      all(is.finite(dane$czestosc)),
      all(is.finite(dane$EARNED_RISK)),
      all(dane$EARNED_RISK > 0)
    )

    model <- lm(
      czestosc ~ i,
      data = dane,
      weights = EARNED_RISK
    )

    opis_modelu(model, rok_modelowy)
  }),
  hrg_lob4
)

# ============================================================
# 3. Pełna tabela: Poisson i ujemny dwumianowy
# ============================================================

poziomy <- c(
  seq(0.1, 0.9, by = 0.1),
  0.95, 0.99, 0.995, 0.999
)

zbuduj_wiersz <- function(j, rodzina) {

  x <- baza_krok3[j, ]
  hrg <- x$HRG
  srednia <- x$m_k

  if (rodzina == "poisson") {

    nazwa <- "poisson"
    lam <- srednia
    n <- NA_real_
    p <- NA_real_

    wariancja <- srednia
    kwantyle <- qpois(poziomy, lambda = lam)

    parametry <- paste0(
      "{'lam': ", formatuj(lam), "}"
    )

  } else {

    nazwa <- "nbinom"
    lam <- NA_real_

    # Parametryzacja zgodna z R: size = n, prob = p
    n <- srednia / (D_lob4 - 1)
    p <- 1 / D_lob4

    wariancja <- srednia * D_lob4
    kwantyle <- qnbinom(poziomy, size = n, prob = p)

    parametry <- paste0(
      "{'n': ", formatuj(n),
      ", 'p': ", formatuj(p), "}"
    )
  }

  wynik <- data.frame(
    LOB = 4,
    HRG = hrg,

    # NBI zgodnie z pokazaną konfiguracją LOB 4
    Wybór = rodzina == "nbinom",

    Rozkład = nazwa,
    `Parametry rozkładu` = parametry,
    lam = lam,
    n = n,
    p = p,

    `Trend LOB` = "liniowy",
    `Statystyki trendu LOB` = statystyki_LOB,

    `Trend HRG` = ifelse(
      hrg == "4M_GC", "brak", "liniowy"
    ),

    `Statystyki trendu HRG` = statystyki_HRG[[hrg]],

    `Udział HRG w LOB` = x$v_k,
    `Częstość HRG` = x$E_k,

    # Pola raportowe jak w Excelu:
    # oszacowana dyspersja jest pokazana w obu wierszach.
    `Dyspersja HRG` = D_lob4,

    # Wynik kroku 1 — rozbieżność z Excelem nadal do wyjaśnienia.
    `Częstość LOB` = E_lob4,
    `Dyspersja LOB` = D_lob4,

    Średnia = srednia,
    Odchylenie = sqrt(wariancja),

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
      zbuduj_wiersz(j, "poisson"),
      zbuduj_wiersz(j, "nbinom")
    )
  })
)

# Odświeżamy również tabelę wybranego rozkładu.
wyniki_wybrane <- wyniki_krok3 %>%
  filter(Wybór)

# ============================================================
# 4. Osobna kontrola zgodności LOB z HRG
# ============================================================

W_LOB <- sum(baza_krok3$W_k)
suma_srednich_HRG <- sum(baza_krok3$m_k)
srednia_LOB <- E_lob4 * W_LOB

kontrola_krok3 <- data.frame(
  rok_modelowy = rok_modelowy,
  czestosc_LOB_krok1 = E_lob4,
  czestosc_LOB_wynikajaca_z_HRG = suma_srednich_HRG / W_LOB,
  dyspersja_LOB = D_lob4,
  ekspozycja_LOB = W_LOB,
  srednia_LOB = srednia_LOB,
  suma_srednich_HRG = suma_srednich_HRG,
  roznica = suma_srednich_HRG - srednia_LOB,
  zgodnosc = isTRUE(
    all.equal(
      srednia_LOB,
      suma_srednich_HRG,
      tolerance = 1e-8
    )
  )
)

options(digits = 15)

print(kontrola_krok3, row.names = FALSE)
View(wyniki_krok3)
