# Podstaw nazwy swoich ramek danych
freq <- FREQ_predictions
sev  <- SEV_predictions
ud   <- u
wd   <- w

# Parametry
rok <- 2000
a <- 26
i_num <- rok - 1999 + 1

# Prawidłowe okresy przyszłych zgłoszeń
j_min <- a - i_num + 2

freq_rok <- subset(freq, i == rok & j >= j_min & j <= a)
sev_rok  <- subset(sev, i == rok)
w_rok    <- subset(wd, i == rok)

cat("Wybrane okresy j:", freq_rok$j, "\n")
cat("Liczba wierszy FREQ:", nrow(freq_rok), "\n")

# Funkcja obliczająca BE dla różnych interpretacji w
policz_BE <- function(wariant, limit_l = Inf) {

  bel <- 0

  for (k in seq_len(nrow(freq_rok))) {

    j <- freq_rok$j[k]
    N <- freq_rok$N_model[k]

    m0 <- j - (a - i_num + 1)

    for (r0 in unique(ud$r)) {

      udzial <- ud$u[ud$r == r0]
      Y <- sev_rok$Y_model[sev_rok$r == r0]

      if (length(udzial) != 1 || length(Y) != 1)
        stop("Brak jednoznacznego u lub Y")

      if (wariant == 1) {
        ww <- subset(w_rok, r == r0 & m == m0 &
                       l >= m0 & l <= limit_l)
      }

      if (wariant == 2) {
        ww <- subset(w_rok, r == r0 & m == m0 &
                       l >= 1 & l <= limit_l)
      }

      if (wariant == 3) {
        ww <- subset(w_rok, r == r0 & l == m0 &
                       m >= m0 & m <= limit_l)
      }

      if (wariant == 4) {
        ww <- subset(w_rok, r == r0 & l == m0 &
                       m >= 1 & m <= limit_l)
      }

      suma_w <- sum(ww$w, na.rm = TRUE)

      bel <- bel + N * udzial * Y * suma_w
    }
  }

  return(bel)
}

# Porównanie wariantów
wyniki <- data.frame()

for (wariant in 1:4) {
  for (limit in c(26, 100, Inf)) {

    wynik <- policz_BE(wariant, limit)

    wyniki <- rbind(
      wyniki,
      data.frame(
        wariant = wariant,
        limit = limit,
        BE = wynik,
        roznica = wynik - 2274034.142
      )
    )
  }
}

wyniki <- wyniki[order(abs(wyniki$roznica)), ]

print(wyniki, row.names = FALSE, digits = 12)
