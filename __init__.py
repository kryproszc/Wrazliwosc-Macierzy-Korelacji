udzialy_odtw <- sev_ind_data %>%
  dplyr::filter(
    as.character(LOB) %in% c("4", "LOB_4"),
    i >= 2022,
    i <= 2024
  ) %>%
  dplyr::count(r, name = "liczba_rent") %>%
  dplyr::mutate(
    udzial = liczba_rent / sum(liczba_rent)
  )

print(udzialy_odtw)
