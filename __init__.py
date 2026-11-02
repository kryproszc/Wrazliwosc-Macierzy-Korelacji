library(dplyr)

# Ekspozycja całego LOB 4 według roku
expo_lob4 <- hist4 %>%
  group_by(i) %>%
  summarise(
    ekspozycja = sum(EARNED_RISK),
    .groups = "drop"
  )

# Liczba rent ultimate całego LOB 4 według roku
number_lob4 <- number4 %>%
  group_by(i) %>%
  summarise(
    N_ult = sum(N_hrg_ult),
    .groups = "drop"
  )

# Łączymy po roku; zachowujemy również lata bez dopasowania
dane_lob4 <- full_join(expo_lob4, number_lob4, by = "i") %>%
  arrange(i) %>%
  mutate(czestosc = N_ult / ekspozycja)

print(dane_lob4, n = Inf)
