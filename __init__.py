weights_data %>%
  filter(i == 2000, m == 1) %>%
  group_by(r) %>%
  summarise(
    suma_w = sum(w),
    .groups = "drop"
  ) %>%
  print(digits = 16)
