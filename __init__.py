lata <- 2000:2024

data.frame(
  rok = lata,
  n_freq = sapply(lata, function(x)
    sum(freq$i == x, na.rm = TRUE)),
  n_sev = sapply(lata, function(x)
    sum(sev$i == x, na.rm = TRUE)),
  n_w = sapply(lata, function(x)
    sum(wd$i == x, na.rm = TRUE))
)


udzial <- ud$u[ud$r == r0]
Y <- sev_rok$Y_model[sev_rok$r == r0]


if (length(udzial) != 1 || length(Y) != 1) {
  stop(paste(
    "Brak lub niejednoznaczne dane:",
    "rok =", rok,
    "typ renty =", r0,
    "liczba u =", length(udzial),
    "liczba Y =", length(Y)
  ))
}
