
# ==========================================
# BE UNDICOUNTED - WZOR (10)
# Lata 2000-2024
# ==========================================

a <- 26
lata <- 2000:2024

wyniki_BE <- data.frame()

for (rok in lata) {

  i_num <- rok - 1999 + 1
  j_min <- a - i_num + 2

  freq_rok <- freq[
    freq$i == rok &
    freq$j >= j_min &
    freq$j <= a, ,
    drop = FALSE
  ]

  sev_rok <- sev[
    sev$i == rok, ,
    drop = FALSE
  ]

  w_rok <- wd[
    wd$i == rok, ,
    drop = FALSE
  ]

  # Sprawdzenie kompletnosci
  if (nrow(freq_rok) != i_num - 1) {
    stop(paste("Nieprawidlowa liczba j:", rok))
  }

  if (nrow(sev_rok) != 2 ||
      !setequal(sev_rok$r, c(1, 2))) {
    stop(paste("Nieprawidlowe dane SEV:", rok))
  }

  if (nrow(w_rok) == 0) {
    stop(paste("Brak wspolczynnikow w:", rok))
  }

  bel <- 0

  for (k in seq_len(nrow(freq_rok))) {

    j <- freq_rok$j[k]
    N <- freq_rok$N_model[k]

    m <- j - (a - i_num + 1)

    if (!is.finite(N)) {
      stop(paste("Nieprawidlowe N:", rok, j))
    }

    for (r0 in c(1, 2)) {

      udzial <- ud$u[ud$r == r0]
      Y <- sev_rok$Y_model[sev_rok$r == r0]

      if (length(udzial) != 1 ||
          length(Y) != 1 ||
          !is.finite(udzial) ||
          !is.finite(Y)) {
        stop(paste(
          "Blad u lub Y:",
          "rok =", rok,
          "r =", r0
        ))
      }

      ww <- w_rok[
        w_rok$r == r0 &
        w_rok$m == m &
        w_rok$l >= m, ,
        drop = FALSE
      ]

      if (nrow(ww) == 0 || anyNA(ww$w) ||
          any(!is.finite(ww$w))) {
        stop(paste(
          "Brak lub blad w:",
          "rok =", rok,
          "j =", j,
          "m =", m,
          "r =", r0
        ))
      }

      suma_w <- sum(ww$w)

      bel <- bel + N * udzial * Y * suma_w
    }
  }

  wyniki_BE <- rbind(
    wyniki_BE,
    data.frame(
      rok = rok,
      BE_model = bel
    )
  )
}

# ==========================================
# WYNIKI
# ==========================================

print(wyniki_BE, row.names = FALSE, digits = 12)

cat("\nLiczba obliczonych lat:",
    nrow(wyniki_BE), "\n")

cat("BE 2000:",
    wyniki_BE$BE_model[wyniki_BE$rok == 2000],
    "\n")
