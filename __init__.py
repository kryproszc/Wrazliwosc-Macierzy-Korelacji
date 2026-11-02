kontrola_czestosci_LOB <- data.frame(
  sposob = c(
    "Prognoza trendu",
    "Średnia historyczna ważona ekspozycją",
    "Średnia historyczna arytmetyczna",
    "Częstość w 2023",
    "Częstość w 2024"
  ),
  czestosc = c(
    as.numeric(predict(
      trend_lob4_indeks,
      newdata = data.frame(t = rok_modelowy - 2006)
    )),
    with(dane_est, sum(N_ult) / sum(ekspozycja)),
    mean(dane_est$czestosc),
    dane_est$czestosc[match(2023, dane_est$i)],
    dane_est$czestosc[match(2024, dane_est$i)]
  )
)

print(
  kontrola_czestosci_LOB,
  digits = 15,
  row.names = FALSE
)
