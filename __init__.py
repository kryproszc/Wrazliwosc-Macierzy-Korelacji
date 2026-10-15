weights_data %>%
  filter(r == 1, i == 2000) %>%
  arrange(m, l) %>%
  print(n = 30)
