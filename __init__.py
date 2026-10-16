# ==========================================
# BE UNDISTCOUNTED – wszystkie lata
# ==========================================

a <- 26
lata <- 2000:2024

wyniki_BE <- data.frame()

for (rok in lata) {

  i_num <- rok - 1999 + 1
  j_min <- a - i_num + 2

  freq_rok <- subset(
    freq,
    i == rok & j >= j_min & j <= a
  )

  sev_rok <- subset(sev, i == rok)
  w_rok <- subset(wd, i == rok)

  bel <- 0

  for (k in seq_len(nrow(freq_rok))) {

    j <- freq_rok$j[k]
    N <- freq_rok$N_model[k]

    m <- j - (a - i_num + 1)

    for (r0 in unique(ud$r)) {

      udzial <- ud$u[ud$r == r0]
      Y <- sev_rok$Y_model[sev_rok$r == r0]

      suma_w <- sum(
        w_rok$w[
          w_rok$r == r0 &
          w_rok$m == m &
          w_rok$l >= m
        ],
        na.rm = TRUE
      )

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
# Wyniki
# ==========================================

print(wyniki_BE, row.names = FALSE, digits = 12)

porownanie <- merge(
  wyniki_BE,
  bel_excel[, c("i", "be_undisc_mod")],
  by.x = "rok",
  by.y = "i"
)

porownanie$roznica <- (
  porownanie$BE_model -
  porownanie$be_undisc_mod
)

porownanie$blad_proc <- (
  100 * porownanie$roznica /
  porownanie$be_undisc_mod
)

print(porownanie, row.names = FALSE, digits = 12)

