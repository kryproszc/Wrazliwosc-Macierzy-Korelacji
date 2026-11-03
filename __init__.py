udzialy <- sev_ind_data |>
  dplyr::filter(
    as.character(LOB) %in% c("4", "LOB_4"),
    i >= 2022, i <= 2024
  ) |>
  dplyr::count(r, name = "liczba_rent") |>
  dplyr::mutate(
    razem = sum(liczba_rent),
    udzial = liczba_rent / razem
  )

print(as.data.frame(udzialy), digits = 17, row.names = FALSE)
