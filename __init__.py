
# ==========================================
# BEL - rezerwy rentowe IBNYR
# Zdyskontowane i niezdyskontowane
# ==========================================

policz_BEL <- function(freq, sev, ud, wd, disc_df,
                       start_year = 1999,
                       end_year = 2024,
                       koszt = 0.018,
                       narzut = 0.0963) {

  a <- end_year - start_year + 1
  lata <- (start_year + 1):end_year

  wymagane <- list(
    freq = c("i", "j", "N_model"),
    sev = c("i", "r", "Y_model"),
    ud = c("r", "u"),
    wd = c("i", "r", "l", "m", "w"),
    disc_df = c("l", "d")
  )

  dane <- list(freq = freq, sev = sev, ud = ud,
               wd = wd, disc_df = disc_df)

  for (nazwa in names(wymagane)) {
    brak <- setdiff(wymagane[[nazwa]], names(dane[[nazwa]]))
    if (length(brak) > 0) {
      stop(paste("Brak kolumn w", nazwa,
                 paste(brak, collapse = ", ")))
    }
  }

  wyniki <- data.frame()

  for (rok in lata) {

    i_num <- rok - start_year + 1
    j_min <- a - i_num + 2

    freq_rok <- freq[
      freq$i == rok &
      freq$j >= j_min &
      freq$j <= a, , drop = FALSE
    ]

    sev_rok <- sev[sev$i == rok, , drop = FALSE]
    w_rok <- wd[wd$i == rok, , drop = FALSE]

    bel_undisc <- 0
    bel_disc <- 0

    for (k in seq_len(nrow(freq_rok))) {

      j0 <- freq_rok$j[k]
      N <- freq_rok$N_model[k]

      m0 <- j0 - (a - i_num + 1)

      for (r0 in ud$r) {

        u0 <- ud$u[ud$r == r0]
        Y <- sev_rok$Y_model[sev_rok$r == r0]

        if (length(u0) != 1 || length(Y) != 1 ||
            anyNA(c(N, u0, Y))) {
          stop(paste("Brak danych: rok", rok,
                     "typ", r0))
        }

        ww <- w_rok[
          w_rok$r == r0 &
          w_rok$m == m0 &
          w_rok$l >= m0, , drop = FALSE
        ]

        if (nrow(ww) == 0 || anyNA(ww$w)) {
          stop(paste("Brak w: rok", rok,
                     "typ", r0, "m =", m0))
        }

        # BE niezdyskontowane
        suma_w <- sum(ww$w)

        bel_undisc <- bel_undisc +
          N * u0 * Y * suma_w

        # BE zdyskontowane
        idx <- match(ww$l, disc_df$l)

        # Nie pomijamy brakujących okresów
        # mających niezerową wypłatę
        aktywne <- is.na(idx) & ww$w != 0

        if (any(aktywne)) {
          stop(paste(
            "Brak dyskonta: rok", rok,
            "typ", r0,
            "okresy:",
            paste(unique(ww$l[aktywne]),
                  collapse = ", ")
          ))
        }

        d_w <- rep(0, nrow(ww))
        obecne <- !is.na(idx)
        d_w[obecne] <- disc_df$d[idx[obecne]]

        if (anyNA(d_w[ww$w != 0])) {
          stop(paste("NA w dyskoncie: rok", rok))
        }

        suma_w_disc <- sum(ww$w * d_w)

        bel_disc <- bel_disc +
          N * u0 * Y * suma_w_disc
      }
    }

    # Koszty i narzut
    wsp <- (1 + koszt) * (1 + narzut)

    wyniki <- rbind(
      wyniki,
      data.frame(
        rok = rok,
        be_undisc_mod = bel_undisc * wsp,
        be_disc_mod = bel_disc * wsp
      )
    )
  }

  return(wyniki)
}

wyniki_BEL <- policz_BEL(
  freq = freq,
  sev = sev,
  ud = ud,
  wd = wd,
  disc_df = disc_df
)

print(wyniki_BEL, row.names = FALSE, digits = 12)


                             
