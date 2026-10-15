
# ============================================================
# PUNKTY 8 i 9 – FREQUENCY × SEVERITY
# Model rezerw rentowych IBNYR
# ============================================================

library(gamlss)

# ------------------------------------------------------------
# 1. Przygotowanie udziałów typów rent
# ------------------------------------------------------------

u_data <- as.data.frame(ann_type_split[, c("r", "u")])

# Zgodność typu zmiennej r z danymi Severity
u_data$r <- as.numeric(as.character(u_data$r))
u_data$u <- as.numeric(u_data$u)

# Kontrola danych
stopifnot(
  !anyNA(u_data),
  !anyDuplicated(u_data$r),
  all(u_data$u >= 0),
  abs(sum(u_data$u) - 1) < 1e-8
)

# ------------------------------------------------------------
# 2. Połączenie Frequency z typami rent
# ------------------------------------------------------------

future_rent <- merge(
  as.data.frame(future_freq),
  u_data,
  by = NULL
)

# Oczekiwana liczba zgłoszeń dla danego typu renty
future_rent$N_r <- future_rent$N_model * future_rent$u

# ------------------------------------------------------------
# 3. Przygotowanie danych do prognozy Severity
# ------------------------------------------------------------

new_sev <- unique(
  future_rent[, c("r", "i")]
)

new_sev <- as.data.frame(new_sev)

new_sev$r <- as.numeric(new_sev$r)
new_sev$i <- as.numeric(new_sev$i)

# ------------------------------------------------------------
# 4. Predykcja parametrów rozkładu LOGNO
# ------------------------------------------------------------

new_sev$mu <- as.numeric(
  predict(
    model_sev,
    newdata = new_sev,
    data = sev,
    what = "mu",
    type = "response"
  )
)

new_sev$sigma <- as.numeric(
  predict(
    model_sev,
    newdata = new_sev,
    data = sev,
    what = "sigma",
    type = "response"
  )
)

# ------------------------------------------------------------
# 5. Oczekiwana kwota roczna renty
# Rozkład LOGNO
# ------------------------------------------------------------

new_sev$Y_model <- exp(
  new_sev$mu + 0.5 * new_sev$sigma^2
)

# Kontrola prognoz
stopifnot(
  !anyNA(new_sev$Y_model),
  all(is.finite(new_sev$Y_model)),
  all(new_sev$Y_model > 0)
)

# ------------------------------------------------------------
# 6. Połączenie prognoz Frequency i Severity
# ------------------------------------------------------------

future_rent <- merge(
  future_rent,
  new_sev[, c("r", "i", "Y_model")],
  by = c("r", "i"),
  all.x = TRUE,
  sort = FALSE
)

future_rent <- future_rent[
  order(future_rent$i, future_rent$j, future_rent$r),
]

rownames(future_rent) <- NULL

# Kontrola kompletności
stopifnot(
  nrow(future_rent) == nrow(future_freq) * nrow(u_data),
  !anyNA(future_rent$Y_model)
)

# ------------------------------------------------------------
# 7. Oczekiwana roczna kwota roszczeń
# ------------------------------------------------------------

future_rent$annual_amount <- (
  future_rent$N_r * future_rent$Y_model
)

# ------------------------------------------------------------
# 8. Podsumowanie wyników
# ------------------------------------------------------------

options(digits = 12)

cat("\n====================================")
cat("\nWYNIKI FREQUENCY × SEVERITY")
cat("\n====================================\n")

cat("\nLiczba wierszy:",
    nrow(future_rent), "\n")

cat("\nOczekiwana liczba zgłoszeń:",
    sum(future_rent$N_r), "\n")

cat("\nSuma oczekiwanych rocznych kwot:",
    sum(future_rent$annual_amount), "\n")

cat("\nPierwsze 10 obserwacji:\n")

print(
  head(
    future_rent[, c(
      "i", "j", "r", "u",
      "N_model", "N_r", "Y_model",
      "annual_amount"
    )],
    10
  )
)

# ------------------------------------------------------------
# 9. Podsumowanie według typu renty
# ------------------------------------------------------------

wyniki_typ <- aggregate(
  cbind(N_r, annual_amount) ~ r,
  data = future_rent,
  FUN = sum
)

cat("\nWyniki według typu renty:\n")
print(wyniki_typ)

# ------------------------------------------------------------
# 10. Podsumowanie według roku szkody
# ------------------------------------------------------------

wyniki_rok <- aggregate(
  cbind(N_r, annual_amount) ~ i,
  data = future_rent,
  FUN = sum
)

cat("\nWyniki według roku szkody:\n")
print(wyniki_rok)
