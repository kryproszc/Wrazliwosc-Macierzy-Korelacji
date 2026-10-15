cashflows_test %>%
  filter(i == 2000) %>%
  group_by(r, m) %>%
  summarise(
    liczba_wyplat = n(),
    suma_w = sum(w),
    annual_amount = first(annual_amount),
    BE = sum(payment),
    .groups = "drop"
  ) %>%
  print(n = Inf, width = Inf)
