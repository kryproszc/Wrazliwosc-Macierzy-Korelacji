sev <- subset(
  severity_data,
  i >= 1999 & i <= 2024
)

# Liczba obserwacji
nrow(sev)

# Liczba obserwacji według typu renty
table(sev$r)

# Podstawowe statystyki
summary(sev)
