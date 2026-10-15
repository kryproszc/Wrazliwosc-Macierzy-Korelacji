library(gamlss)

freq <- subset(
  frequency_data,
  i >= start_year & i <= end_year
)

# Podstawowe informacje o danych
str(freq)
summary(freq)

# Liczba obserwacji
nrow(freq)

# Kontrola wartości brakujących
colSums(is.na(freq[, c("i", "j", "N")]))

# Kontrola liczby roszczeń
table(freq$N)
