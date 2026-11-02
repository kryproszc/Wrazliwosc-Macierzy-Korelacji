library(dplyr)

# Dane dla trzech HRG — odtworzenie ultimate
stopifnot(
  !anyDuplicated(number4[c("HRG", "i")]),
  !anyDuplicated(hist4[c("HRG", "i")]),
  all(is.finite(number4$N_lob_hist)),
  all(number4$N_lob_hist > 0)
)

dane_krok2 <- number4 %>%
  mutate(
    N_ult_odtw = N_hrg_hist +
      (N_lob_ult - N_lob_hist) * N_hrg_hist / N_lob_hist,

    roznica_Excel = N_ult_odtw - N_hrg_ult
  ) %>%
  left_join(
    hist4 %>% select(HRG, i, EARNED_RISK),
    by = c("HRG", "i")
  ) %>%
  arrange(HRG, i) %>%
  mutate(czestosc = N_ult_odtw / EARNED_RISK)

# Zakres roboczy zgodny z dotychczasowymi obliczeniami.
# Nie zastępujemy brakujących danych zerami.
rok_od <- 2007
rok_do <- 2024
rok_prognozy <- rok_modelowy

porownaj_hrg <- function(hrg) {

  d <- dane_krok2 %>%
    filter(HRG == hrg, i >= rok_od, i <= rok_do)

  stopifnot(
    nrow(d) > 2,
    all(is.finite(d$czestosc)),
    all(is.finite(d$EARNED_RISK)),
    all(d$EARNED_RISK > 0)
  )

  # Dwa warianty estymacji trendu
  ols <- lm(czestosc ~ i, data = d)

  wazony <- lm(
    czestosc ~ i,
    data = d,
    weights = EARNED_RISK
  )

  stat_ols <- summary(ols)
  stat_wazony <- summary(wazony)

  f2023 <- d$czestosc[d$i == 2023]

  data.frame(
    LOB = 4,
    HRG = hrg,
    rok_od = min(d$i),
    rok_do = max(d$i),
    liczba_lat = nrow(d),

    Trend_HRG_Config = if (hrg == "4M_GC") "brak" else "liniowy",

    # Zapis trendu: a + b * rok
    a_OLS = unname(coef(ols)[1]),
    b_OLS = unname(coef(ols)[2]),
    p_value_trendu_OLS = stat_ols$coefficients[2, 4],
    R2_OLS = stat_ols$r.squared,

    a_wazony = unname(coef(wazony)[1]),
    b_wazony = unname(coef(wazony)[2]),
    p_value_trendu_wazony = stat_wazony$coefficients[2, 4],
    R2_wazony = stat_wazony$r.squared,

    # Wariant bez trendu
    czestosc_srednia_wazona =
      sum(d$N_ult_odtw) / sum(d$EARNED_RISK),

    # Prognozy częstości z trendu
    czestosc_prognoza_OLS = as.numeric(
      predict(ols, newdata = data.frame(i = rok_prognozy))
    ),

    czestosc_prognoza_wazona = as.numeric(
      predict(wazony, newdata = data.frame(i = rok_prognozy))
    ),

    czestosc_surowa_2023 =
      if (length(f2023) == 1) f2023 else NA_real_,

    max_roznica_ultimate_Excel =
      max(abs(d$roznica_Excel))
  )
}

porownanie_krok2 <- bind_rows(
  lapply(hrg_lob4, porownaj_hrg)
)

options(digits = 15)
print(as.data.frame(porownanie_krok2), row.names = FALSE)

# Wygodny podgląd w RStudio
View(porownanie_krok2)
