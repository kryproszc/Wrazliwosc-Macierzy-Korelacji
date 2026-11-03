library(gamlss)
library(gamlss.dist)

# 1. Próba dla LOB 4, zgodnie z zakresem w Config
# Nie indeksujemy ponownie Y i nie usuwamy automatycznie obserwacji.

sev4 <- as.data.frame(sev_ind_data)

sev4 <- sev4[
  !is.na(sev4$LOB) &
    as.character(sev4$LOB) %in% c("4", "LOB_4") &
    !is.na(sev4$i) &
    sev4$i >= 1999 &
    sev4$i <= 2024,
  c("r", "i", "Y")
]

stopifnot(
  nrow(sev4) > 0,
  !anyNA(sev4),
  is.numeric(sev4$i),
  is.numeric(sev4$Y),
  all(is.finite(sev4$Y)),
  all(sev4$Y > 0)
)

sev4$r <- factor(sev4$r)

# Kontrola liczby obserwacji według roku i typu renty
print(with(sev4, table(i, r)))

# 2. Model dokładnie według wskazanych formuł
# LOGNO: domyślne linki mu = identity, sigma = log.

model_sev4 <- gamlss(
  formula = Y ~ factor(r) + cs(i, df = 1),
  sigma.formula = ~ 1,
  family = LOGNO(
    mu.link = "identity",
    sigma.link = "log"
  ),
  data = sev4,
  control = gamlss.control(n.cyc = 100)
)

if (!isTRUE(model_sev4$converged)) {
  stop("Model nie osiągnął zbieżności — nie porównujemy jeszcze prognoz.")
}

# 3. Rok 2025 — każdy typ renty występujący w próbie
nowe_dane <- data.frame(
  r = factor(levels(sev4$r), levels = levels(sev4$r)),
  i = 2025
)

mu_2025 <- as.numeric(
  predict(
    model_sev4,
    what = "mu",
    newdata = nowe_dane,
    data = sev4,
    type = "response"
  )
)

sigma_2025 <- as.numeric(
  predict(
    model_sev4,
    what = "sigma",
    newdata = nowe_dane,
    data = sev4,
    type = "response"
  )
)

# 4. Tabela odpowiadająca SEV_distr_GAMLSS
wyniki_sev_gamlss <- data.frame(
  LOB = "LOB_4",
  r = as.character(nowe_dane$r),
  distr_name = "LOGNO",
  i = nowe_dane$i,
  mu = mu_2025,
  sigma = sigma_2025,
  mean = exp(mu_2025 + sigma_2025^2 / 2)
)

options(digits = 15)

print(wyniki_sev_gamlss, row.names = FALSE)
View(wyniki_sev_gamlss)
