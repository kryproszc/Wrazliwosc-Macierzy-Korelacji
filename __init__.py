dane_est <- dane_est %>%
  mutate(t = i - 2006)

trend_lob4_indeks <- lm(
  czestosc ~ t,
  data = dane_est,
  weights = ekspozycja
)

# Wyraz wolny, nachylenie i ich p-value
print(
  coef(summary(trend_lob4_indeks)),
  digits = 15
)

# R²
print(
  summary(trend_lob4_indeks)$r.squared,
  digits = 15
)

# Prognoza dla roku modelowego
print(
  predict(
    trend_lob4_indeks,
    newdata = data.frame(t = rok_modelowy - 2006)
  ),
  digits = 15
)
