# ============================================================
# PUNKTY 8 i 9 – FREQUENCY × SEVERITY
# ============================================================

# 1. Udziały typów rent
u_data <- as.data.frame(ann_type_split[, c("r", "u")])

stopifnot(
  !anyNA(u_data),
  !anyDuplicated(u_data$r),
  abs(sum(u_data$u) - 1) < 1e-8
)

# 2. Przypisanie typów rent do przyszłych zgłoszeń
future_rent <- merge(
  future_freq,
  u_data,
  by = NULL
)

# 3. Oczekiwana liczba zgłoszeń danego typu
future_rent$N_r <- future_rent$N_model * future_rent$u

# 4. Prognoza parametrów Severity
new_sev <- unique(future_rent[, c("r", "i")])

new_sev$mu <- predict(
  model_sev,
  newdata = new_sev,
  data = sev,
  what = "mu",
  type = "response"
)

new_sev$sigma <- predict(
  model_sev,
  newdata = new_sev,
  data = sev,
  what = "sigma",
  type = "response"
)

# 5. Średnia kwota roczna renty LOGNO
new_sev$Y_model <- exp(
  new_sev$mu + new_sev$sigma^2 / 2
)

# 6. Połączenie wyników
future_rent <- merge(
  future_rent,
  new_sev[, c("r", "i", "Y_model")],
  by = c("r", "i")
)

future_rent <- future_rent[
  order(future_rent$i, future_rent$j, future_rent$r),
]

rownames(future_rent) <- NULL

# 7. Oczekiwana roczna kwota roszczeń
future_rent$annual_amount <- (
  future_rent$N_r * future_rent$Y_model
)

# 8. Wyniki
print(head(future_rent, 10))

cat("\nLiczba wierszy:", nrow(future_rent))

cat("\nOczekiwana liczba zgłoszeń:",
    sum(future_rent$N_r))

cat("\nSuma oczekiwanych rocznych kwot:",
    sum(future_rent$annual_amount), "\n")
