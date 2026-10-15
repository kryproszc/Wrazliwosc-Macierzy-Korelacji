library(gamlss)
library(dplyr)

# Przygotowanie danych
porownanie_sev <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_data = mean(Y),
    Y_model = mean(Y_model),
    .groups = "drop"
  )

sev_r1 <- porownanie_sev %>% filter(r == 1) %>% arrange(i)
sev_r2 <- porownanie_sev %>% filter(r == 2) %>% arrange(i)

# Reszty kwantylowe
res <- residuals(model_sev, type = "normalized")
mu <- fitted(model_sev, what = "mu")

# Układ kwadratowy 2 x 2
par(mfrow = c(2, 2), mar = c(6, 4, 3, 1))

# 1. Reszty vs wartości dopasowane
plot(mu, res,
     pch = 16, cex = 0.4,
     main = "Severity - reszty vs dopasowanie",
     xlab = "Dopasowane mu",
     ylab = "Reszty kwantylowe")
abline(h = 0, col = "red", lty = 2)

# 2. Q-Q plot
qqnorm(res,
       pch = 16, cex = 0.4,
       main = "Severity - Q-Q plot")
qqline(res, col = "red", lwd = 2)

# 3. Typ renty 1
barplot(
  t(as.matrix(sev_r1[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r1$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.6,
  main = "Severity - typ renty 1",
  ylab = "Srednia kwota",
  legend.text = c("Model", "Dane")
)

# 4. Typ renty 2
barplot(
  t(as.matrix(sev_r2[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r2$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.6,
  main = "Severity - typ renty 2",
  ylab = "Srednia kwota",
  legend.text = c("Model", "Dane")
)

par(mfrow = c(1, 1))
