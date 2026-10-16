wyniki_m <- data.frame()

for (m_test in 1:26) {

  bel <- 0

  for (r0 in unique(ud$r)) {

    N <- freq_rok$N_model[1]
    udzial <- ud$u[ud$r == r0]
    Y <- sev_rok$Y_model[sev_rok$r == r0]

    suma_w <- sum(
      wd$w[
        wd$i == 2000 &
        wd$r == r0 &
        wd$m == m_test &
        wd$l >= m_test
      ],
      na.rm = TRUE
    )

    bel <- bel + N * udzial * Y * suma_w
  }

  wyniki_m <- rbind(
    wyniki_m,
    data.frame(
      m = m_test,
      BE = bel,
      roznica = bel - 2274034.142
    )
  )
}

print(wyniki_m, row.names = FALSE)
