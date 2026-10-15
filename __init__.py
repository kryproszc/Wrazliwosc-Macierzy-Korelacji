library(gamlss)
library(gamlss.dist)
library(dplyr)

# =====================================================
# 1. PRZYGOTOWANIE DANYCH
# =====================================================

start_year <- 1999
end_year <- 2024

sev <- severity_data %>%
  filter(i >= start_year, i <= end_year) %>%
  select(r, i, Y) %>%
  as.data.frame()

# Kontrola danych
summary(sev)
nrow(sev)
table(sev$r)
colSums(is.na(sev))


# =====================================================
# 2. ESTYMACJA MODELU GAMLSS - LOGNO
# =====================================================

model_sev <- gamlss(
  Y ~ factor(r) + cs(i, df = 1),
  sigma.formula = ~ 1,
  family = LOGNO(
    mu.link = "identity",
    sigma.link = "log"
  ),
  data = sev,
  trace = FALSE
)

# Wyniki estymacji
summary(model_sev)

# Współczynniki z pełną precyzją
options(digits = 12)

coef(model_sev, what = "mu")
coef(model_sev, what = "sigma")


# =====================================================
# 3. PARAMETRY ROZKŁADU LOGNORMALNEGO
# =====================================================

sev$mu <- as.numeric(
  fitted(model_sev, what = "mu")
)

sev$sigma <- as.numeric(
  fitted(model_sev, what = "sigma")
)

# =====================================================
# 4. OCZEKIWANA ROCZNA KWOTA RENTY
# =====================================================

sev$Y_model <- exp(
  sev$mu + sev$sigma^2 / 2
)

# Pierwsze 10 obserwacji
head(sev, 10)


# =====================================================
# 5. PROGNOZY DLA 2 TYPÓW RENT I LAT 1999-2024
# =====================================================

wyniki_sev <- sev %>%
  group_by(r, i) %>%
  summarise(
    mu = mean(mu),
    sigma = mean(sigma),
    Y_model = mean(Y_model),
    .groups = "drop"
  ) %>%
  arrange(r, i)

print(as.data.frame(wyniki_sev), digits = 12)


# =====================================================
# 6. PORÓWNANIE Z DANYMI RZECZYWISTYMI
# =====================================================

porownanie_sev <- sev %>%
  group_by(r, i) %>%
  summarise(
    Y_data = mean(Y),
    Y_model = mean(Y_model),
    .groups = "drop"
  )

sev_r1 <- porownanie_sev %>%
  filter(r == 1) %>%
  arrange(i)

sev_r2 <- porownanie_sev %>%
  filter(r == 2) %>%
  arrange(i)


# =====================================================
# 7. WYKRES DIAGNOSTYCZNY GAMLSS
# =====================================================

plot(model_sev)


# =====================================================
# 8. WYKRES SEVERITY - TYP RENTY 1
# =====================================================

barplot(
  t(as.matrix(sev_r1[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r1$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.7,
  legend.text = c("Y_model", "Y_data"),
  main = "Severity - typ renty 1",
  ylab = "Srednia roczna kwota renty"
)


# =====================================================
# 9. WYKRES SEVERITY - TYP RENTY 2
# =====================================================

barplot(
  t(as.matrix(sev_r2[, c("Y_model", "Y_data")])),
  beside = TRUE,
  names.arg = sev_r2$i,
  col = c("steelblue", "darkorange"),
  las = 2,
  cex.names = 0.7,
  legend.text = c("Y_model", "Y_data"),
  main = "Severity - typ renty 2",
  ylab = "Srednia roczna kwota renty"
)
