rok <- 2000
a <- 26
i_num <- rok - 1999 + 1

freq_rok <- subset(freq, i == rok & j >= a - i_num + 2)
sev_rok <- subset(sev, i == rok)
w_rok <- subset(wd, i == rok)

bel_disc <- 0

for (k in seq_len(nrow(freq_rok))) {

  j <- freq_rok$j[k]
  N <- freq_rok$N_model[k]

  m <- j - (a - i_num + 1)

  for (r0 in unique(ud$r)) {

    u0 <- ud$u[ud$r == r0]
    Y <- sev_rok$Y_model[sev_rok$r == r0]

    ww <- subset(w_rok, r == r0 & m == !!m)
  }
}


bel_disc <- 0

for (k in seq_len(nrow(freq_rok))) {

  j0 <- freq_rok$j[k]
  N <- freq_rok$N_model[k]
  m0 <- j0 - (a - i_num + 1)

  for (r0 in ud$r) {

    u0 <- ud$u[ud$r == r0]
    Y <- sev_rok$Y_model[sev_rok$r == r0]

    ww <- w_rok[
      w_rok$r == r0 &
      w_rok$m == m0 &
      w_rok$l >= m0,
    ]

    idx <- match(ww$l, disc_df$l)

    if (anyNA(idx)) {
      stop("Brakuje współczynników dyskontowych dla części okresów l")
    }

    suma_w_disc <- sum(ww$w * disc_df$d[idx])

    bel_disc <- bel_disc + N * u0 * Y * suma_w_disc
  }
}

bel_disc <- bel_disc * 1.018 * 1.0963

cat("BE disc 2000:", bel_disc, "\n")
