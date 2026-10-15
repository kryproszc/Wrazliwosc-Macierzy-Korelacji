weights_data %>%
  filter(r == 1, i == 2000, m %in% c(1, 2, 3)) %>%
  group_by(m) %>%
  summarise(
    min_l = min(l),
    max_l = max(l),
    liczba = n(),
    suma_w = sum(w),
    .groups = "drop"
  )
