par(mfrow = c(2, 1), mar = c(7, 4, 4, 2))

barplot(
  t(as.matrix(sev_r1[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r1$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.8,
  legend.text = c("Y_model", "Y_data"),
  main = "Porównanie średniej kwoty renty obserwowanej i dopasowanej: typ 1",
  ylab = "Wartości"
)

barplot(
  t(as.matrix(sev_r2[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r2$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.8,
  legend.text = c("Y_model", "Y_data"),
  main = "Porównanie średniej kwoty renty obserwowanej i dopasowanej: typ 2",
  ylab = "Wartości"
)

par(mfrow = c(1, 1))
