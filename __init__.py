# Struktura danych
str(severity_data)

# Podstawowe statystyki
summary(severity_data)

# Liczba obserwacji
nrow(severity_data)

# Liczba obserwacji według typu renty
table(severity_data$r)

# Brakujące wartości
colSums(is.na(severity_data))
