
dane_est <- dane_lob4 %>%
  filter(i >= 2007, i <= 2024)

print(dane_est, n = Inf)

# Trend liniowy ważony ekspozycją
trend_lob4 <- lm(
  czestosc ~ i,
  data = dane_est,
  weights = ekspozycja
)

a <- unname(coef(trend_lob4)["i"])
b <- unname(coef(trend_lob4)["(Intercept)"])

# Prognoza częstości na kolejny rok
rok_modelowy <- max(dane_est$i) + 1

E_lob4 <- as.numeric(predict(
  trend_lob4,
  newdata = data.frame(i = rok_modelowy)
))

data.frame(a, b, rok_modelowy, E_lob4)

# Dane i dopasowana prosta
plot(
  dane_est$i, dane_est$czestosc,
  type = "b",
  xlab = "Rok szkodowy",
  ylab = "Częstość rent"
)

lines(
  dane_est$i,
  fitted(trend_lob4),
  col = "red",
  lwd = 2
)
