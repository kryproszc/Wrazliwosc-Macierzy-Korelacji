# ============================================================
# PUNKT 7 – PROGNOZOWANIE PRZYSZŁYCH ZGŁOSZEŃ RENTOWYCH
# Model Frequency – GAMLSS NBI
# ============================================================

library(gamlss)

# 1. Parametry
start_year <- 1999
end_year <- 2024
a <- end_year - start_year + 1

# 2. Utworzenie przyszłych komórek trójkąta
future_freq <- expand.grid(
  i = (start_year + 1):end_year,
  j = 1:a
)

# 3. Wybór nieobserwowanych komórek
future_freq <- subset(
  future_freq,
  j >= end_year - i + 2
)

# 4. Sortowanie
future_freq <- future_freq[
  order(future_freq$i, future_freq$j),
]

rownames(future_freq) <- NULL

# 5. Prognozowanie liczby zgłoszeń z GAMLSS
future_freq$N_model <- predict(
  model_freq,
  newdata = future_freq,
  data = freq,
  what = "mu",
  type = "response"
)

# 6. Wyniki
options(digits = 12)

print(head(future_freq, 20))

cat("\nLiczba przyszłych komórek:",
    nrow(future_freq), "\n")

cat("Łączna oczekiwana liczba przyszłych zgłoszeń:",
    sum(future_freq$N_model), "\n")

# 7. Prognoza według roku szkody
future_by_year <- aggregate(
  N_model ~ i,
  data = future_freq,
  FUN = sum
)

print(future_by_year)
