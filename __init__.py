wyniki_delay <- aggregate(
  cbind(N_data = N, N_model = N_model) ~ j,
  data = freq,
  FUN = sum
)

barplot(
  t(as.matrix(wyniki_delay[, c("N_model", "N_data")])),
  beside = TRUE,
  names.arg = wyniki_delay$j,
  col = c("steelblue", "coral"),
  las = 2,
  legend.text = c("N_model", "N_data"),
  main = "Liczba rent według opóźnienia zgłoszenia",
  xlab = "Opóźnienie j",
  ylab = "Liczba rent"
)
