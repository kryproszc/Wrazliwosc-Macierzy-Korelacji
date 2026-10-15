weights_data %>%
  count(r, i, l, m) %>%
  summarise(
    liczba_kombinacji = n(),
    liczba_duplikatow = sum(n > 1),
    max_powtorzen = max(n)
  )
