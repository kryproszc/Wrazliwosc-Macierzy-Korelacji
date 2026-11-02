czestosci_hrg <- porownanie_krok2 %>%
  mutate(
    sposob = case_when(
      HRG == "4K_MTPL" ~ "Prognoza trendu ważonego",
      HRG == "4M_GC"   ~ "Średnia ważona bez trendu",
      HRG == "4M_MTPL" ~ "Surowa częstość 2023 — do potwierdzenia"
    ),

    E_k = case_when(
      HRG == "4K_MTPL" ~ czestosc_prognoza_wazona,
      HRG == "4M_GC"   ~ czestosc_srednia_wazona,
      HRG == "4M_MTPL" ~ czestosc_surowa_2023
    )
  ) %>%
  select(LOB, HRG, sposob, E_k)

print(
  as.data.frame(czestosci_hrg),
  digits = 15,
  row.names = FALSE
)
