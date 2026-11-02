# Prognozy z dotychczasowego modelu LOB
kontrola_lat <- data.frame(i = 2023:2025)

kontrola_lat$czestosc_LOB <- as.numeric(
  predict(trend_lob4, newdata = kontrola_lat)
)

print(kontrola_lat, digits = 15, row.names = FALSE)

# Parametry dopasowanego trendu
print(coef(trend_lob4), digits = 15)

# Zakres danych użytych do dopasowania
print(
  data.frame(
    rok_od = min(dane_est$i),
    rok_do = max(dane_est$i),
    liczba_lat = nrow(dane_est)
  ),
  row.names = FALSE
)

# Dostępne lata planowanej ekspozycji
print(sort(unique(plan4$YEAR)))

# Dotychczasowa prognoza i częstość wynikająca z HRG
print(porownanie_E_LOB, digits = 15, row.names = FALSE)
