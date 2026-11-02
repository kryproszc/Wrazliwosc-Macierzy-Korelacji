# Wariant zgodny z obsługą brakujących lat w kodzie kolegi
kontrola_gc <- kontrola_gc %>%
  mutate(
    brak_wpisu = is.na(N_hrg_ult),
    N_ult_kalibracja = coalesce(N_hrg_ult, 0),
    czestosc = N_ult_kalibracja / EARNED_RISK
  )

E_gc <- with(
  kontrola_gc,
  sum(N_ult_kalibracja) / sum(EARNED_RISK)
)

print(E_gc, digits = 15)
