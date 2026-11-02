library(readxl)
library(dplyr)

# ============================================================
# USTAWIENIA
# ============================================================

file <- file.choose()

hrg_lob4 <- c("4K_MTPL", "4M_GC", "4M_MTPL")

rok_od <- 2007
rok_do <- 2024
rok_modelowy <- 2025

# Z pokazanej konfiguracji:
rok_czestosci_4M_MTPL <- 2023
wybrany_rozklad <- "nbinom"

poziomy_kwantyli <- c(
  seq(0.1, 0.9, by = 0.1),
  0.95, 0.99, 0.995, 0.999
)

options(digits = 15)

# ============================================================
# 1. WCZYTANIE DANYCH
# ============================================================

exposure_hist_data <- read_excel(file, sheet = "expo_hist")
exposure_data      <- read_excel(file, sheet = "expo_plan_HRG")
number_ult_data    <- read_excel(file, sheet = "FREQ_ult")

hist4 <- exposure_hist_data %>%
  filter(
    HRG %in% hrg_lob4,
    i >= rok_od,
    i <= rok_do
  ) %>%
  select(HRG, i, EARNED_RISK)

number4 <- number_ult_data %>%
  filter(
    HRG %in% hrg_lob4,
    i >= rok_od,
    i <= rok_do
  ) %>%
  select(
    HRG, i,
    N_hrg_hist, N_lob_ult, N_lob_hist, N_hrg_ult
  )

plan4 <- exposure_data %>%
  filter(HRG %in% hrg_lob4) %>%
  select(HRG, YEAR, EARNED_RISK)

stopifnot(
  !anyDuplicated(hist4[c("HRG", "i")]),
  !anyDuplicated(number4[c("HRG", "i")]),
  all(is.finite(hist4$EARNED_RISK)),
  all(hist4$EARNED_RISK > 0)
)

# Każdy HRG musi mieć ekspozycję dla całych lat 2007–2024.
for (hrg in hrg_lob4) {
  stopifnot(
    setequal(
      hist4$i[hist4$HRG == hrg],
      rok_od:rok_do
    )
  )
}

plan_modelowy <- plan4 %>%
  filter(YEAR == rok_modelowy)

stopifnot(
  setequal(plan_modelowy$HRG, hrg_lob4),
  !anyDuplicated(plan_modelowy$HRG),
  all(is.finite(plan_modelowy$EARNED_RISK)),
  all(plan_modelowy$EARNED_RISK > 0)
)

# ============================================================
# 2. ODTWORZENIE ULTIMATE HRG — WZÓR Z KROKU 2
# ============================================================

number_odtw <- number4 %>%
  mutate(
    N_ult_odtw = case_when(

      is.finite(N_lob_hist) & N_lob_hist > 0 ~
        N_hrg_hist +
        (N_lob_ult - N_lob_hist) *
        N_hrg_hist / N_lob_hist,

      # Dla zerowego LOB i zerowego ultimate przyjmujemy 0.
      N_lob_hist == 0 &
        N_lob_ult == 0 &
        N_hrg_hist == 0 ~ 0,

      TRUE ~ NA_real_
    )
  )

# Ekspozycja jest podstawą pełnego szeregu lat.
dane_krok2 <- hist4 %>%
  left_join(
    number_odtw %>% mutate(wpis_w_FREQ_ult = TRUE),
    by = c("HRG", "i")
  ) %>%
  mutate(
    wpis_w_FREQ_ult = coalesce(wpis_w_FREQ_ult, FALSE),

    # Uzgodniona konwencja odtworzenia dla 4M_GC:
    # brak wpisu / brak ultimate w pliku traktujemy jako zero.
    zero_GC = HRG == "4M_GC" & is.na(N_hrg_ult),

    N_ult_plik = if_else(
      zero_GC, 0, N_hrg_ult
    ),

    N_ult_odtw = if_else(
      zero_GC, 0, N_ult_odtw
    ),

    roznica_Excel = N_ult_odtw - N_ult_plik,

    czestosc = N_ult_odtw / EARNED_RISK,

    # 2007 -> 1, ..., 2024 -> 18
    t = i - rok_od + 1
  ) %>%
  arrange(HRG, i)

# Innych braków nie zastępujemy automatycznie zerami.
if (
  any(!is.finite(dane_krok2$N_ult_plik)) ||
  any(!is.finite(dane_krok2$N_ult_odtw))
) {
  stop(
    "Nie można odtworzyć części ultimate. ",
    "Sprawdź dane_krok2: braki lub zerowy mianownik N_lob_hist."
  )
}

kontrola_ultimate <- dane_krok2 %>%
  group_by(HRG) %>%
  summarise(
    liczba_lat = n(),
    liczba_zer_uzupelnionych_GC = sum(zero_GC),
    max_roznica_ultimate_Excel = max(abs(roznica_Excel)),
    .groups = "drop"
  )

# ============================================================
# KROK 1 — CZĘSTOŚĆ I DYSPERSJA LOB
# ============================================================

# Budujemy LOB jako sumę trzech HRG w każdym roku.
# N_lob_ult nie sumujemy, ponieważ jest powtarzane przy HRG.

dane_est <- dane_krok2 %>%
  group_by(i) %>%
  summarise(
    ekspozycja = sum(EARNED_RISK),
    N_ult = sum(N_ult_plik),
    .groups = "drop"
  ) %>%
  arrange(i) %>%
  mutate(
    t = i - rok_od + 1,
    czestosc = N_ult / ekspozycja
  )

trend_lob4 <- lm(
  czestosc ~ t,
  data = dane_est,
  weights = ekspozycja
)

t_modelowy <- rok_modelowy - rok_od + 1

E_lob4 <- as.numeric(
  predict(
    trend_lob4,
    newdata = data.frame(t = t_modelowy)
  )
)

dane_est <- dane_est %>%
  mutate(
    czestosc_dopasowana = as.numeric(fitted(trend_lob4))
  )

if (any(dane_est$czestosc_dopasowana <= 0)) {
  stop("Trend LOB daje niedodatnie częstości historyczne.")
}

# Estymator dyspersji dla częstości:
# wagi = ekspozycja, funkcja wariancji = mu, N-2.

D_lob4 <- with(
  dane_est,
  sum(
    ekspozycja *
      (czestosc - czestosc_dopasowana)^2 /
      czestosc_dopasowana
  ) / (nrow(dane_est) - 2)
)

W_lob4 <- sum(plan_modelowy$EARNED_RISK)

wynik_krok1 <- data.frame(
  LOB = 4,
  rok_modelowy = rok_modelowy,
  a = unname(coef(trend_lob4)[1]),
  b = unname(coef(trend_lob4)[2]),
  R2 = summary(trend_lob4)$r.squared,
  czestosc_prognoza_LOB = E_lob4,
  dyspersja_LOB = D_lob4,
  ekspozycja_LOB = W_lob4,
  srednia_z_prognozy_LOB = E_lob4 * W_lob4
)

# ============================================================
# KROK 2 — MODELE I KOŃCOWE CZĘSTOŚCI HRG
# ============================================================

modele_HRG <- setNames(
  lapply(hrg_lob4, function(hrg) {

    if (hrg == "4M_GC") {
      return(NULL)
    }

    dane <- dane_krok2 %>%
      filter(HRG == hrg)

    lm(
      czestosc ~ t,
      data = dane,
      weights = EARNED_RISK
    )
  }),
  hrg_lob4
)

wynik_krok2 <- bind_rows(
  lapply(hrg_lob4, function(hrg) {

    dane <- dane_krok2 %>%
      filter(HRG == hrg)

    srednia_wazona <- with(
      dane,
      sum(N_ult_odtw) / sum(EARNED_RISK)
    )

    if (hrg == "4M_GC") {

      prognoza_trendu <- NA_real_
      E_k <- srednia_wazona
      sposob <- "Średnia ważona 2007–2024"
      a <- b <- p_a <- p_b <- R2 <- NA_real_

    } else {

      model <- modele_HRG[[hrg]]
      s <- summary(model)
      wsp <- coef(s)

      a <- unname(coef(model)[1])
      b <- unname(coef(model)[2])
      p_a <- wsp[1, 4]
      p_b <- wsp[2, 4]
      R2 <- s$r.squared

      prognoza_trendu <- as.numeric(
        predict(
          model,
          newdata = data.frame(t = t_modelowy)
        )
      )

      if (hrg == "4M_MTPL") {

        wybrany_rok <- dane %>%
          filter(i == rok_czestosci_4M_MTPL)

        stopifnot(nrow(wybrany_rok) == 1L)

        E_k <- wybrany_rok$czestosc

        sposob <- paste(
          "Surowa częstość z roku",
          rok_czestosci_4M_MTPL
        )

      } else {

        E_k <- prognoza_trendu
        sposob <- "Prognoza trendu ważonego"
      }
    }

    data.frame(
      LOB = 4,
      HRG = hrg,
      rok_od = min(dane$i),
      rok_do = max(dane$i),
      liczba_lat = nrow(dane),
      Trend_HRG = ifelse(hrg == "4M_GC", "brak", "liniowy"),
      a = a,
      b = b,
      p_a = p_a,
      p_b = p_b,
      R2 = R2,
      prognoza_trendu = prognoza_trendu,
      srednia_wazona = srednia_wazona,
      sposob_wyboru_czestosci = sposob,
      E_k = E_k,
      check.names = FALSE
    )
  })
)

# ============================================================
# KROK 3 — ŚREDNIE, UDZIAŁY I KONTROLA ZGODNOŚCI
# ============================================================

baza_krok3 <- wynik_krok2 %>%
  left_join(
    plan_modelowy %>%
      transmute(HRG, W_k = EARNED_RISK),
    by = "HRG"
  ) %>%
  mutate(
    m_k = E_k * W_k,
    v_k = m_k / sum(m_k)
  )

stopifnot(
  all(is.finite(baza_krok3$E_k)),
  all(baza_krok3$E_k > 0),
  is.finite(D_lob4),
  D_lob4 > 1
)

suma_m_HRG <- sum(baza_krok3$m_k)

kontrola_krok3 <- data.frame(
  rok_modelowy = rok_modelowy,
  czestosc_LOB_z_trendu = E_lob4,
  czestosc_LOB_wynikajaca_z_HRG = suma_m_HRG / W_lob4,
  dyspersja_LOB = D_lob4,
  srednia_LOB_z_trendu = E_lob4 * W_lob4,
  suma_srednich_HRG = suma_m_HRG,
  roznica = suma_m_HRG - E_lob4 * W_lob4,
  zgodnosc = isTRUE(
    all.equal(
      E_lob4 * W_lob4,
      suma_m_HRG,
      tolerance = 1e-8
    )
  )
)

# ============================================================
# OPIS STATYSTYK TRENDÓW DO TABELI
# ============================================================

fmt <- function(x) {
  paste(sprintf("%.15g", x), collapse = ", ")
}

opis_trendu <- function(model) {

  s <- summary(model)
  wsp <- coef(s)

  prognoza <- as.numeric(
    predict(
      model,
      newdata = data.frame(t = t_modelowy)
    )
  )

  paste0(
    "trend_params: {a: ", fmt(coef(model)[1]),
    ", b: ", fmt(coef(model)[2]), "}",
    "; pvalues: [", fmt(wsp[, 4]), "]",
    "; r2: ", fmt(s$r.squared),
    "; pred: ", fmt(prognoza)
  )
}

statystyki_LOB <- opis_trendu(trend_lob4)

# ============================================================
# TABELA ODPOWIADAJĄCA FREQ_distr
# ============================================================

zbuduj_wiersz <- function(j, rodzina) {

  x <- baza_krok3[j, ]
  hrg <- x$HRG
  srednia <- x$m_k

  if (rodzina == "poisson") {

    lam <- srednia
    n <- NA_real_
    p <- NA_real_

    wariancja <- srednia

    kwantyle <- qpois(
      poziomy_kwantyli,
      lambda = lam
    )

    parametry <- paste0(
      "{lam: ", fmt(lam), "}"
    )

  } else {

    lam <- NA_real_
    n <- srednia / (D_lob4 - 1)
    p <- 1 / D_lob4

    wariancja <- srednia * D_lob4

    kwantyle <- qnbinom(
      poziomy_kwantyli,
      size = n,
      prob = p
    )

    parametry <- paste0(
      "{n: ", fmt(n),
      ", p: ", fmt(p), "}"
    )
  }

  statystyki_hrg <- if (hrg == "4M_GC") {
    "Brak trendu"
  } else {
    opis_trendu(modele_HRG[[hrg]])
  }

  wynik <- data.frame(
    LOB = 4,
    HRG = hrg,
    Wybór = rodzina == wybrany_rozklad,
    Rozkład = rodzina,
    `Parametry rozkładu` = parametry,
    lam = lam,
    n = n,
    p = p,
    `Trend LOB` = "liniowy",
    `Statystyki trendu LOB` = statystyki_LOB,
    `Trend HRG` = x$Trend_HRG,
    `Statystyki trendu HRG` = statystyki_hrg,
    `Udział HRG w LOB` = x$v_k,
    `Częstość HRG` = x$E_k,

    # Raportujemy oszacowaną dyspersję jak w Excelu.
    # Wariancja Poissona nadal wynosi jego średnią.
    `Dyspersja HRG` = D_lob4,

    # Wartość z kroku 1.
    # Nie zastępujemy jej niewyjaśnioną liczbą z Excela.
    `Częstość LOB` = E_lob4,

    `Dyspersja LOB` = D_lob4,
    Średnia = srednia,
    Odchylenie = sqrt(wariancja),
    check.names = FALSE
  )

  for (k in seq_along(poziomy_kwantyli)) {
    wynik[[as.character(poziomy_kwantyli[k])]] <- kwantyle[k]
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

wyniki_wybrane <- wyniki_krok3 %>%
  filter(Wybór)

# ============================================================
# DODATKOWA KONTROLA DEFINICJI CZĘSTOŚCI LOB
# ============================================================

kontrola_czestosci_LOB <- data.frame(
  sposob = c(
    "Prognoza trendu",
    "Średnia historyczna ważona ekspozycją",
    "Średnia historyczna arytmetyczna",
    "Częstość w 2023",
    "Częstość w 2024",
    "Częstość wynikająca z końcowych średnich HRG"
  ),
  czestosc = c(
    E_lob4,
    with(dane_est, sum(N_ult) / sum(ekspozycja)),
    mean(dane_est$czestosc),
    dane_est$czestosc[match(2023, dane_est$i)],
    dane_est$czestosc[match(2024, dane_est$i)],
    suma_m_HRG / W_lob4
  )
)

# ============================================================
# WYNIKI
# ============================================================

print(kontrola_ultimate, width = Inf)
print(wynik_krok1, row.names = FALSE)
print(as.data.frame(wynik_krok2), row.names = FALSE)
print(kontrola_krok3, row.names = FALSE)
print(kontrola_czestosci_LOB, row.names = FALSE)

View(wyniki_krok3)
