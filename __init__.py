N <- freq_rok$N_model[1]

diag <- data.frame()

for (r0 in 1:2) {

  Y <- sev_rok$Y_model[sev_rok$r == r0]
  u0 <- ud$u[ud$r == r0]

  sw <- sum(wd$w[
    wd$i == 2000 &
    wd$r == r0 &
    wd$m == 1
  ])

  diag <- rbind(diag, data.frame(
    r = r0,
    N = N,
    u = u0,
    Y = Y,
    suma_w = sw,
    BE = N * u0 * Y * sw
  ))
}

print(diag, digits = 14)

BE_nasz <- sum(diag$BE)
BE_excel <- 2274034.142

cat("\nBE nasz:", BE_nasz)
cat("\nBE Excel:", BE_excel)
cat("\nN wykorzystane:", N)
cat("\nN wymagane przy obecnych Y, u, w:",
    BE_excel / sum(diag$u * diag$Y * diag$suma_w))
cat("\n")
