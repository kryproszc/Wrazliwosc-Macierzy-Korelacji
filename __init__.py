plot(model_freq)

# Prognozy z modelu
freq$N_model <- fitted(model_freq, what = "mu")

# Agregacja według roku szkody
wyniki_rok <- aggregate(
  cbind(N_data = N, N_model = N_model) ~ i,
  data = freq,
  FUN = sum
)

# Wykres
barplot(
  t(as.matrix(wyniki_rok[, c("N_model", "N_data")])),
  beside = TRUE,
  names.arg = wyniki_rok$i,
  col = c("steelblue", "coral"),
  las = 2,
  cex.names = 0.7,
  legend.text = c("N_model", "N_data"),
  main = "Liczba rent według roku szkody",
  ylab = "Liczba rent"
)
