# 1. Częstości dopasowane trendem
dane_est$f_dopasowana <- as.numeric(fitted(trend_lob4))

# Kontrola danych potrzebnych do obliczeń
stopifnot(
  nrow(dane_est) > 2,
  all(is.finite(dane_est$czestosc)),
  all(dane_est$ekspozycja > 0),
  all(dane_est$f_dopasowana > 0),
  is.finite(E_lob4),
  E_lob4 > 0
)

# 2. Dyspersja po uwzględnieniu trendu
D_lob4 <- with(
  dane_est,
  sum(
    ekspozycja * (czestosc - f_dopasowana)^2 /
      f_dopasowana
  ) / (nrow(dane_est) - 2)
)

# 3. Planowana ekspozycja całego LOB 4
plan_model4 <- plan4[plan4$YEAR == rok_modelowy, ]

stopifnot(
  nrow(plan_model4) == length(hrg_lob4),
  setequal(plan_model4$HRG, hrg_lob4),
  !anyDuplicated(plan_model4$HRG),
  all(is.finite(plan_model4$EARNED_RISK)),
  all(plan_model4$EARNED_RISK > 0)
)

W_lob4 <- sum(plan_model4$EARNED_RISK)

# 4. Oczekiwana liczba rent
mu_lob4 <- E_lob4 * W_lob4

# 5. Parametry kandydatów: Poisson i ujemny dwumianowy
parametry_lob4 <- data.frame(
  rok = rok_modelowy,
  czestosc_E = E_lob4,
  ekspozycja_W = W_lob4,
  dyspersja_oszacowana = D_lob4,
  srednia_liczby = mu_lob4,
  sd_Poisson = sqrt(mu_lob4),
  sd_NBinom = if (D_lob4 > 1) sqrt(mu_lob4 * D_lob4) else NA_real_,
  size_NBinom = if (D_lob4 > 1) mu_lob4 / (D_lob4 - 1) else NA_real_,
  prob_NBinom = if (D_lob4 > 1) 1 / D_lob4 else NA_real_
)

print(parametry_lob4, digits = 15)
