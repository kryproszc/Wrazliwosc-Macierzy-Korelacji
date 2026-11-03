wynik <- as.data.frame(udzialy_odtw)
wynik$udzial <- formatC(
  wynik$udzial,
  format = "f",
  digits = 5
)

print(wynik, row.names = FALSE)
